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
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Documentos</h1>
        <label className="inline-flex cursor-pointer items-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {uploading ? 'Enviando…' : 'Anexar documento'}
          <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      <ErrorAlert error={error} />

      {loading ? (
        <div className="text-gray-500">Carregando…</div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhum documento." hint="Anexe um arquivo para armazená-lo de forma real." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Nome</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Processo</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Tipo</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Tamanho</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Extraído</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Enviado</th>
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
                    {d.process_id ? <Link to={`/processos/${d.process_id}`} className="text-brand-600 hover:underline">{d.process_title ?? 'Processo'}</Link> : <span className="text-gray-400">—</span>}
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
                    <a href={downloadUrl(`/api/documents/${d.id}/download`)} className="mr-2 text-brand-600 hover:underline">Baixar</a>
                    <button onClick={() => handleDelete(d.id)} className="text-red-600 hover:underline">Excluir</button>
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