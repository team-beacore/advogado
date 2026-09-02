import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { apiGet, apiPost, apiPatch } from '../api/client';
import {
  Button, SecondaryButton, Select, Input, Badge, ErrorAlert, EmptyState, statusColor, statusLabel, formatDateTime,
} from '../components/ui';
import { useAuth } from '../auth/AuthContext';

interface DiscoveryDetail {
  id: string;
  process_number: string;
  source: string;
  sources?: string[];
  court: string | null;
  court_code: string | null;
  judicial_system: string | null;
  class: string | null;
  subjects?: string[] | null;
  title: string | null;
  status: string;
  confidence: number | null;
  discovered_at: string;
  existing_case_id: string | null;
  existing_case_title: string | null;
  existing_case_client_id: string | null;
  identity_professional_name: string | null;
  identity_oab_number: string | null;
  identity_oab_state: string | null;
  identity_user_id: string | null;
  suggestedResponsible: { userId: string; professionalName: string | null; oabNumber: string | null; oabState: string | null } | null;
  movementsCount: number;
  publicationsCount: number;
  parties: string[];
  possibleClient: Array<{ name: string; confirmed: boolean }>;
}

function confidenceLabel(c: number | null): string {
  if (c == null) return 'Desconhecida';
  if (c >= 1) return 'Alta';
  if (c >= 0.5) return 'Média';
  if (c >= 0.2) return 'Baixa';
  return 'Desconhecida';
}

export default function ProcessDiscoveryReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [detail, setDetail] = useState<DiscoveryDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);

  const [responsibleId, setResponsibleId] = useState('');
  const [clientMode, setClientMode] = useState<'existing' | 'new' | 'none'>('none');
  const [clientId, setClientId] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [submitting, setSubmitting] = useState<'import' | 'reject' | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<DiscoveryDetail>(`/api/process-discovery/results/${id}`);
      setDetail(res);
      if (res.suggestedResponsible) setResponsibleId(res.suggestedResponsible.userId);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [id]);

  useEffect(() => {
    void apiGet<Array<{ id: string; name: string; role: string }>>('/api/organizations/members').then((r) => setTeam(r)).catch(() => {});
    void apiGet<{ items: Array<{ id: string; name: string }> }>('/api/clients').then((r) => setClients(r.items)).catch(() => {});
  }, []);

  if (loading) {
    return <div className="py-12 text-center text-sm text-gray-400">Carregando…</div>;
  }

  if (!detail) {
    return (
      <div>
        <EmptyState title="Resultado não encontrado" hint="Este resultado de descoberta pode ter sido removido." />
        <div className="mt-4">
          <Link to="/descoberta" className="text-sm font-medium text-brand-700 hover:text-brand-800">← Voltar</Link>
        </div>
      </div>
    );
  }

  const isDuplicate = Boolean(detail.existing_case_id);
  const canImport = user?.permissions?.includes('process_discovery.import') ?? false;

  const doImport = async () => {
    setActionError(null);
    setSubmitting('import');
    try {
      const body: Record<string, unknown> = { responsibleId: responsibleId || null };
      if (clientMode === 'existing' && clientId) body.clientId = clientId;
      if (clientMode === 'new' && newClientName.trim()) body.newClient = { name: newClientName.trim() };
      await apiPost(`/api/process-discovery/results/${id}/import`, body);
      navigate('/descoberta');
    } catch (e) { setActionError(e); setSubmitting(null); }
  };

  const doReject = async () => {
    setActionError(null);
    setSubmitting('reject');
    try {
      await apiPatch(`/api/process-discovery/results/${id}`, { status: 'REJECTED' });
      navigate('/descoberta');
    } catch (e) { setActionError(e); setSubmitting(null); }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link to="/descoberta" className="text-sm font-medium text-brand-700 hover:text-brand-800">← Voltar para descobertas</Link>
      </div>

      {error ? <ErrorAlert error={error} /> : null}

      <div className="mb-6 rounded-xl border border-gray-200/90 bg-white p-6 shadow-card">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge color={isDuplicate ? 'purple' : statusColor(detail.status)}>
            {isDuplicate ? 'Já cadastrado' : statusLabel(detail.status)}
          </Badge>
          <Badge color="blue">{confidenceLabel(detail.confidence)}</Badge>
          <Badge color="gray">Fonte: {detail.source}</Badge>
        </div>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Número CNJ</div>
              <div className="font-mono font-semibold text-gray-900">{detail.process_number}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Tribunal</div>
              <div className="text-gray-900">{detail.court ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Sistema</div>
              <div className="text-gray-900">{detail.judicial_system ?? detail.source ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Classe</div>
              <div className="text-gray-900">{detail.class ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Descoberta em</div>
              <div className="text-gray-900">{formatDateTime(detail.discovered_at)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Fontes</div>
              <div className="text-gray-900">{(detail.sources ?? [detail.source]).join(', ')}</div>
            </div>
          </div>

          {detail.parties.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Partes disponíveis</div>
              <div className="text-gray-900">{detail.parties.join(' • ')}</div>
            </div>
          )}

          <div className="flex flex-wrap gap-5 border-t border-gray-100 pt-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Movimentações</div>
              <div className="font-semibold text-gray-900">{detail.movementsCount}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Publicações/comunicações</div>
              <div className="font-semibold text-gray-900">{detail.publicationsCount}</div>
            </div>
          </div>

          {detail.identity_professional_name || detail.identity_oab_number ? (
            <div className="rounded-lg bg-brand-50/70 px-4 py-3 ring-1 ring-inset ring-brand-100">
              <div className="text-xs uppercase tracking-wide text-brand-500">Advogado relacionado</div>
              <div className="font-medium text-gray-900">
                {detail.identity_professional_name ?? '—'}
                {detail.identity_oab_number ? ` — OAB/${detail.identity_oab_state ?? '—'} ${detail.identity_oab_number}` : ''}
              </div>
            </div>
          ) : null}

          {isDuplicate && (
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Este processo já está cadastrado nesta instalação ({detail.existing_case_title ?? 'processo existente'}).
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200/90 bg-white p-6 shadow-card">
        <h2 className="mb-4 font-display text-base font-semibold text-gray-900">Responsável</h2>
        <Select
          value={responsibleId}
          onChange={(e) => setResponsibleId(e.target.value)}
          disabled={!canImport}
        >
          <option value="">Sem responsável</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.role})
            </option>
          ))}
        </Select>

        <h2 className="mb-4 mt-6 font-display text-base font-semibold text-gray-900">Cliente</h2>
        <div className="mb-3 flex gap-2">
          {(['none', 'existing', 'new'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setClientMode(mode)}
              disabled={!canImport}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                clientMode === mode
                  ? 'bg-brand-700 text-white'
                  : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {mode === 'none' ? 'Sem cliente' : mode === 'existing' ? 'Selecionar cliente' : 'Criar cliente'}
            </button>
          ))}
        </div>
        {clientMode === 'existing' && (
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!canImport}>
            <option value="">Selecione…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        )}
        {clientMode === 'new' && (
          <Input
            value={newClientName}
            onChange={(e) => setNewClientName(e.target.value)}
            placeholder="Nome do novo cliente"
            disabled={!canImport}
          />
        )}

        {detail.possibleClient.length > 0 && (
          <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-500 ring-1 ring-inset ring-gray-100">
            <div className="mb-1 font-semibold text-gray-600">Possível cliente (não confirmado)</div>
            {detail.possibleClient.map((p) => (
              <div key={p.name}>• {p.name}</div>
            ))}
            <div className="mt-1.5">A associação só ocorre mediante confirmação. Nenhum cliente é criado automaticamente.</div>
          </div>
        )}

        {actionError ? <div className="mt-4"><ErrorAlert error={actionError} /></div> : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={() => void doImport()} disabled={!canImport || submitting !== null}>
            {submitting === 'import' ? 'Importando…' : 'Importar processo'}
          </Button>
          <SecondaryButton onClick={() => void doReject()} disabled={submitting !== null || detail.status === 'IMPORTED' || detail.status === 'REJECTED'}>
            {submitting === 'reject' ? 'Rejeitando…' : 'Rejeitar'}
          </SecondaryButton>
        </div>
      </div>
    </div>
  );
}