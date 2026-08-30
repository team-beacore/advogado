import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet } from '../api/client';
import { Card, Badge, EmptyState, ErrorAlert, formatDate, statusColor, statusLabel } from '../components/ui';

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

export default function ClientDetail() {
  const { id } = useParams();
  const [data, setData] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<ClientDetail>(`/api/clients/${id}`)
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="text-gray-500">Carregando…</div>;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;

  return (
    <div>
      <div className="mb-6">
        <Link to="/clientes" className="text-sm text-brand-600 hover:underline">← Clientes</Link>
        <h1 className="mt-1 text-2xl font-semibold">{data.name}</h1>
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
                  <Link to={`/processos/${String(c.id)}`} className="flex items-center justify-between rounded border border-gray-100 px-3 py-2 hover:border-brand-300">
                    <div>
                      <div className="text-sm font-medium">{String(c.title)}</div>
                      <div className="text-xs text-gray-500">{String(c.process_number ?? '')} · {String(c.court ?? '')}</div>
                    </div>
                    <Badge color={statusColor(String(c.status))}>{statusLabel(String(c.status))}</Badge>
                  </Link>
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
                <li key={String(d.id)} className="flex items-center justify-between rounded border border-gray-100 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{String(d.name)}</div>
                    <div className="text-xs text-gray-500">{String(d.process_title ?? '')} · {formatDate(String(d.created_at))}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}