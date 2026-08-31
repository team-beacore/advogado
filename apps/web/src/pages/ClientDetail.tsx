import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet, apiPut, apiPost, apiDelete } from '../api/client';
import { Card, Badge, EmptyState, ErrorAlert, formatDate, statusColor, statusLabel, Button, SecondaryButton } from '../components/ui';

interface ClientDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  cpf_cnpj: string | null;
  notes: string | null;
  cases: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
}

interface ClientPrefs {
  emailEnabled: boolean;
  processUpdatesEnabled: boolean;
}

interface PortalStatus {
  portal: { id: string; email: string; status: string } | null;
}

interface ShareRow {
  case_id: string;
  title: string;
  process_number: string | null;
  status: string;
  can_view_documents: boolean;
}

export default function ClientDetail() {
  const { id } = useParams();
  const [data, setData] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<ClientPrefs | null>(null);
  const [prefsError, setPrefsError] = useState<unknown>(null);
  const [portal, setPortal] = useState<PortalStatus['portal'] | null>(null);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [portalMsg, setPortalMsg] = useState('');
  const [portalError, setPortalError] = useState<unknown>(null);

  useEffect(() => {
    apiGet<ClientDetail>(`/api/clients/${id}`)
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [id]);

  const loadPrefs = useCallback(() => {
    apiGet<ClientPrefs>(`/api/clients/${id}/notification-preferences`)
      .then(setPrefs)
      .catch((e) => setPrefsError(e));
  }, [id]);

  const loadPortal = useCallback(() => {
    apiGet<PortalStatus>(`/api/clients/${id}/portal`).then((r) => setPortal(r.portal)).catch((e) => setPortalError(e));
    apiGet<{ items: ShareRow[] }>(`/api/clients/${id}/shares`).then((r) => setShares(r.items)).catch(() => setShares([]));
  }, [id]);

  useEffect(() => { loadPrefs(); }, [loadPrefs]);
  useEffect(() => { loadPortal(); }, [loadPortal]);

  const savePrefs = async (next: Partial<ClientPrefs>) => {
    setPrefsError(null);
    try {
      const saved = await apiPut<ClientPrefs>(`/api/clients/${id}/notification-preferences`, next);
      setPrefs(saved);
    } catch (err) { setPrefsError(err); }
  };

  const invitePortal = async () => {
    setPortalError(null);
    setPortalMsg('');
    try {
      const res = await apiPost<{ temporaryPassword: string; email: string }>(`/api/clients/${id}/portal/invite`, { email: data?.email ?? '' });
      setPortalMsg(`Portal criado. Senha temporária (envie ao cliente com segurança): ${res.temporaryPassword}`);
      void loadPortal();
    } catch (err) { setPortalError(err); }
  };

  const revokePortal = async () => {
    if (!confirm('Revogar o acesso do cliente ao portal?')) return;
    setPortalError(null);
    try {
      await apiDelete(`/api/clients/${id}/portal`);
      setPortal(null);
      setShares([]);
    } catch (err) { setPortalError(err); }
  };

  const toggleShare = async (caseId: string, enable: boolean) => {
    setPortalError(null);
    try {
      if (enable) {
        await apiPost(`/api/clients/${id}/shares`, { caseId, canViewDocuments: false });
      } else {
        await apiDelete(`/api/clients/${id}/shares/${caseId}`);
      }
      void loadPortal();
    } catch (err) { setPortalError(err); }
  };

  if (loading) return <div className="flex items-center gap-2.5 text-sm text-gray-500"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-brand-600" />Carregando…</div>;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;

  const sharedIds = new Set(shares.map((s) => s.case_id));

  return (
    <div>
      <div className="mb-6">
        <Link to="/clientes" className="inline-flex items-center gap-1.5 text-sm link-quiet">← Clientes</Link>
        <h1 className="page-title mt-1.5">{data.name}</h1>
        <div className="mt-1 text-sm text-gray-500">
          {data.email && <span className="mr-3">{data.email}</span>}
          {data.phone && <span className="mr-3">{data.phone}</span>}
          {data.cpf_cnpj && <span>{data.cpf_cnpj}</span>}
        </div>
        {data.notes && <p className="mt-3 text-sm text-gray-600">{data.notes}</p>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Processos vinculados">
          {data.cases.length === 0 ? (
            <EmptyState title="Nenhum processo vinculado." />
          ) : (
            <ul className="space-y-2">
              {data.cases.map((c) => (
                <li key={String(c.id)}>
                  <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3.5 py-3 transition-all duration-200 hover:border-brand-300 hover:bg-brand-50/40 hover:shadow-sm">
                    <Link to={`/processos/${String(c.id)}`} className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900">{String(c.title)}</div>
                      <div className="text-xs text-gray-500">{String(c.process_number ?? '')} · {String(c.court ?? '')}</div>
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge color={statusColor(String(c.status))}>{statusLabel(String(c.status))}</Badge>
                      {portal && (
                        <button
                          onClick={() => void toggleShare(String(c.id), !sharedIds.has(String(c.id)))}
                          className={`text-xs font-medium ${sharedIds.has(String(c.id)) ? 'text-green-600 hover:underline' : 'text-gray-400 hover:text-gray-700 hover:underline'}`}
                        >
                          {sharedIds.has(String(c.id)) ? 'Compartilhado' : 'Compartilhar'}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Documentos">
          {data.documents.length === 0 ? (
            <EmptyState title="Nenhum documento." />
          ) : (
            <ul className="space-y-2">
              {data.documents.map((d) => (
                <li key={String(d.id)} className="flex items-center justify-between rounded-lg border border-gray-200 px-3.5 py-3 transition-colors hover:bg-gray-50">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{String(d.name)}</div>
                    <div className="text-xs text-gray-500">{String(d.process_title ?? '')} · {formatDate(String(d.created_at))}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Portal do cliente">
          <ErrorAlert error={portalError} />
          {portalMsg && <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{portalMsg}</div>}
          {portal ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                Portal ativo ({portal.status === 'ACTIVE' ? 'ativo' : 'convidado'}) — <b>{portal.email}</b>
              </div>
              <p className="text-xs text-gray-500">Compartilhe processos com este cliente para liberar acesso no portal.</p>
              <div className="flex gap-2">
                <SecondaryButton onClick={() => void revokePortal()} className="px-3 py-1.5 text-xs text-red-600">Revogar acesso</SecondaryButton>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Libere um login para este cliente acompanhar os processos no portal. O cliente continua o mesmo cadastro — não criamos uma conta duplicada.
              </p>
              <Button onClick={() => void invitePortal()} className="px-3 py-1.5 text-xs">Convidar cliente para o portal</Button>
            </div>
          )}
        </Card>
        <Card title="Comunicação com o cliente">
          <p className="mb-3 text-xs text-gray-500">
            Controle se este cliente recebe avisos de movimentação nos processos. O cliente recebe apenas um aviso genérico — nunca o conteúdo da intimação.
          </p>
          <ErrorAlert error={prefsError} />
          {prefs && (
            <div className="space-y-3">
              <label className="flex items-center justify-between text-sm">
                <span>Receber atualizações de processos</span>
                <input type="checkbox" checked={prefs.processUpdatesEnabled} onChange={(e) => void savePrefs({ processUpdatesEnabled: e.target.checked })} />
              </label>
              <label className="flex items-center justify-between text-sm">
                <span>Por e-mail</span>
                <input type="checkbox" checked={prefs.emailEnabled} onChange={(e) => void savePrefs({ emailEnabled: e.target.checked })} />
              </label>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}