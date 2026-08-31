import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../api/client';
import { Card, Badge, EmptyState, ErrorAlert, formatDate, statusColor, statusLabel } from '../components/ui';

interface PortalProcess {
  id: string;
  title: string;
  process_number: string | null;
  court: string | null;
  area: string | null;
  status: string;
  can_view_documents: boolean;
  created_at: string;
}

interface PortalProfile {
  id: string;
  email: string;
  client_id: string;
  client_name: string;
  status: string;
}

export default function PortalDashboard() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [processes, setProcesses] = useState<PortalProcess[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, procs] = await Promise.all([
        apiGet<{ client: PortalProfile | null }>('/api/portal/me'),
        apiGet<{ items: PortalProcess[] }>('/api/portal/processes'),
      ]);
      if (!p.client) { navigate('/portal/login'); return; }
      setProfile(p.client);
      setProcesses(procs.items);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }, [navigate]);

  useEffect(() => { void load(); }, [load]);

  const logout = async () => {
    try { await apiPost('/api/portal/logout'); } catch { /* noop */ }
    navigate('/portal/login');
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Carregando…</div>;
  if (error) return <div className="flex min-h-screen items-center justify-center"><ErrorAlert error={error} /></div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="font-display text-lg font-semibold text-gray-900">Portal do Cliente</h1>
            {profile && <div className="text-sm text-gray-500">Olá, {profile.client_name}</div>}
          </div>
          <button onClick={() => void logout()} className="text-sm text-gray-500 hover:text-gray-900">Sair</button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <Card title="Meus processos">
          {processes.length === 0 ? (
            <EmptyState title="Nenhum processo compartilhado." hint="Quando seu advogado compartilhar um processo, ele aparecerá aqui." />
          ) : (
            <ul className="space-y-3">
              {processes.map((p) => (
                <li key={p.id}>
                  <Link to={`/portal/processos/${p.id}`} className="block rounded-lg border border-gray-200 px-4 py-3 transition-colors hover:border-brand-300 hover:bg-brand-50/40">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">{p.title}</div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {p.process_number ?? ''} {p.court ? ` · ${p.court}` : ''} {p.area ? ` · ${p.area}` : ''}
                        </div>
                        <div className="mt-1 text-xs text-gray-400">Atualizado em {formatDate(p.created_at)}</div>
                      </div>
                      <Badge color={statusColor(p.status)}>{statusLabel(p.status)}</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </div>
  );
}