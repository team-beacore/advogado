import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client';
import { Badge, EmptyState, ErrorAlert, statusColor, statusLabel, formatDateTime } from '../components/ui';

interface DiscoveryItem {
  id: string;
  process_number: string;
  source: string;
  court: string | null;
  class: string | null;
  status: string;
  confidence: number | null;
  discovered_at: string;
  identity_professional_name: string | null;
  identity_oab_number: string | null;
  identity_oab_state: string | null;
  existing_case_id: string | null;
  existing_case_title: string | null;
}

function confidenceColor(confidence: number | null): string {
  if (confidence == null) return 'gray';
  if (confidence >= 1) return 'green';
  if (confidence >= 0.5) return 'blue';
  if (confidence >= 0.2) return 'yellow';
  return 'gray';
}

function confidenceLabel(confidence: number | null): string {
  if (confidence == null) return 'Desconhecida';
  if (confidence >= 1) return 'Alta';
  if (confidence >= 0.5) return 'Média';
  if (confidence >= 0.2) return 'Baixa';
  return 'Desconhecida';
}

export default function ProcessDiscovery() {
  const [items, setItems] = useState<DiscoveryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('pageSize', '100');
      const res = await apiGet<{ items: DiscoveryItem[]; total: number }>(`/api/process-discovery/results?${params}`);
      setItems(res.items);
      setTotal(res.total);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [statusFilter]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-gray-900">Processos descobertos</h1>
          <p className="mt-1 text-sm text-gray-500">
            Revise os processos encontrados pelas fontes judiciais e confirme a importação.
          </p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {['', 'PENDING_REVIEW', 'IMPORTED', 'REJECTED', 'DUPLICATE'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'bg-brand-700 text-white shadow-sm'
                : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            {s
              ? { PENDING_REVIEW: 'Pendentes', IMPORTED: 'Importados', REJECTED: 'Rejeitados', DUPLICATE: 'Duplicados' }[s] ?? s
              : 'Todos'}
          </button>
        ))}
      </div>

      {error ? <ErrorAlert error={error} /> : null}

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-400">Carregando…</div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhum processo descoberto" hint="Execute uma descoberta para encontrar processos." />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-gray-200/90 bg-white p-5 shadow-card transition-shadow hover:shadow-elevated"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-gray-900">{item.process_number}</span>
                    <Badge color={item.existing_case_id ? 'purple' : statusColor(item.status)}>
                      {item.existing_case_id ? 'Já cadastrado' : statusLabel(item.status)}
                    </Badge>
                    <Badge color={confidenceColor(item.confidence)}>{confidenceLabel(item.confidence)}</Badge>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                    <span>{item.court ?? '—'}</span>
                    {item.class && <span>• {item.class}</span>}
                    <span>• Fonte: {item.source}</span>
                    <span>• {formatDateTime(item.discovered_at)}</span>
                  </div>
                  {(item.identity_professional_name || item.identity_oab_number) && (
                    <div className="mt-1.5 text-xs text-gray-500">
                      Advogado: {item.identity_professional_name ?? '—'} — OAB/{item.identity_oab_state ?? '—'} {item.identity_oab_number ?? '—'}
                    </div>
                  )}
                  {item.existing_case_title && (
                    <div className="mt-1.5 text-xs text-gray-500">
                      Caso existente: {item.existing_case_title}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link
                    to={`/descoberta/${item.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-700 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-800"
                  >
                    Revisar
                  </Link>
                </div>
              </div>
            </div>
          ))}
          <div className="pt-2 text-center text-xs text-gray-400">
            {total} resultado{total !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}