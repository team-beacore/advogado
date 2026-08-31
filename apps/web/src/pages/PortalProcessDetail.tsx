import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../api/client';
import { Card, Badge, ErrorAlert, formatDate, statusColor, statusLabel } from '../components/ui';

interface PortalProcessDetail {
  id: string;
  title: string;
  process_number: string | null;
  court: string | null;
  area: string | null;
  status: string;
  description: string | null;
  created_at: string;
  can_view_documents: boolean;
}

interface PortalDocument {
  id: string;
  name: string;
  file_name: string;
  mime_type: string;
  size: number;
  created_at: string;
}

export default function PortalProcessDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [process, setProcess] = useState<PortalProcessDetail | null>(null);
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, d] = await Promise.all([
        apiGet<{ process: PortalProcessDetail | null }>(`/api/portal/processes/${id}`),
        apiGet<{ items: PortalDocument[] }>(`/api/portal/processes/${id}/documents`).catch(() => ({ items: [] })),
      ]);
      if (!p.process) { navigate('/portal'); return; }
      setProcess(p.process);
      setDocuments(d.items);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }, [id, navigate]);

  useEffect(() => { void load(); }, [load]);

  const logout = async () => {
    try { await apiPost('/api/portal/logout'); } catch { /* noop */ }
    navigate('/portal/login');
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Carregando…</div>;
  if (error) return <div className="flex min-h-screen items-center justify-center"><ErrorAlert error={error} /></div>;
  if (!process) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <div>
            <Link to="/portal" className="text-sm text-brand-600 hover:underline">← Meus processos</Link>
            <h1 className="mt-1 font-display text-lg font-semibold text-gray-900">{process.title}</h1>
          </div>
          <button onClick={() => void logout()} className="text-sm text-gray-500 hover:text-gray-900">Sair</button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <Card title="Dados do processo">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><dt className="text-xs text-gray-500">Número</dt><dd className="text-sm font-medium">{process.process_number ?? '—'}</dd></div>
            <div><dt className="text-xs text-gray-500">Tribunal</dt><dd className="text-sm font-medium">{process.court ?? '—'}</dd></div>
            <div><dt className="text-xs text-gray-500">Área</dt><dd className="text-sm font-medium">{process.area ?? '—'}</dd></div>
            <div><dt className="text-xs text-gray-500">Status</dt><dd className="text-sm"><Badge color={statusColor(process.status)}>{statusLabel(process.status)}</Badge></dd></div>
          </dl>
          {process.description && <p className="mt-4 text-sm text-gray-700">{process.description}</p>}
        </Card>

        {process.can_view_documents && documents.length > 0 && (
          <div className="mt-6">
            <Card title="Documentos">
              <ul className="space-y-2">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3.5 py-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{d.name}</div>
                      <div className="text-xs text-gray-500">{d.mime_type} · {formatDate(d.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}