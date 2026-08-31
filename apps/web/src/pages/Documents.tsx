import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiUpload, apiDelete, apiPost, downloadUrl } from '../api/client';
import {
  EmptyState, ErrorAlert, formatBytes, formatDateTime, Badge,
} from '../components/ui';

interface DocumentItem {
  id: string;
  name: string;
  file_name: string;
  mime_type: string;
  size: number;
  hash: string;
  created_at: string;
  process_id: string | null;
  process_title: string | null;
  uploaded_by_name: string | null;
  extraction_status: string | null;
}

function extractionLabel(status: string | null): string {
  if (!status || status === 'NONE') return 'Não extraído';
  if (status === 'EXTRACTED') return 'Extraído';
  if (status === 'FAILED') return 'Falha';
  if (status === 'NOT_CONFIGURED') return 'OCR não configurado';
  return status;
}

export default function Documents() {
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [extractingId, setExtractingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: DocumentItem[] }>('/api/documents');
      setItems(res.items);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', file.name);
      await apiUpload('/api/documents', formData);
      await load();
    } catch (err) { setError(err); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este documento?')) return;
    try {
      await apiDelete(`/api/documents/${id}`);
      await load();
    } catch (err) { setError(err); }
  };

  const handleExtract = async (id: string) => {
    setExtractingId(id);
    setError(null);
    try {
      await apiPost(`/api/documents/${id}/extract`);
      await load();
    } catch (err) { setError(err); }
    finally { setExtractingId(null); }
  };

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200/80 pb-5">
        <h1 className="page-title">Documentos</h1>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-inset ring-brand-800/40 transition-all duration-200 hover:bg-brand-800 hover:shadow-elevated disabled:opacity-45">
          {uploading ? 'Enviando…' : 'Anexar documento'}
          <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      <ErrorAlert error={error} />

      {loading ? (
        <div className="flex items-center gap-2.5 text-sm text-gray-500"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-brand-600" />Carregando…</div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhum documento." hint="Anexe um arquivo para armazená-lo de forma real." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="table-legal min-w-full">
            <thead className="bg-gray-50/70">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Nome</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Processo</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Tipo</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Tamanho</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Extraído</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500">Enviado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-gray-400">{d.hash?.slice(0, 12)}…</div>
                  </td>
                  <td className="px-4 py-2">
                    {d.process_id ? <Link to={`/processos/${d.process_id}`} className="link-quiet">{d.process_title ?? 'Processo'}</Link> : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{d.mime_type}</td>
                  <td className="px-4 py-2 text-gray-500">{formatBytes(d.size)}</td>
                  <td className="px-4 py-2">
                    <Badge color={d.extraction_status === 'EXTRACTED' ? 'green' : d.extraction_status === 'FAILED' || d.extraction_status === 'NOT_CONFIGURED' ? 'yellow' : 'gray'}>
                      {extractionLabel(d.extraction_status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{formatDateTime(d.created_at)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => handleExtract(d.id)} disabled={extractingId === d.id} className="mr-2 text-brand-600 hover:underline disabled:opacity-50">
                      {extractingId === d.id ? 'Extraindo…' : 'Extrair texto'}
                    </button>
                    <a href={downloadUrl(`/api/documents/${d.id}/download`)} className="mr-3 text-sm link-quiet">Baixar</a>
                    <button onClick={() => handleDelete(d.id)} className="text-sm font-medium text-danger-600 underline-offset-4 transition-colors hover:text-danger-700 hover:underline">Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}