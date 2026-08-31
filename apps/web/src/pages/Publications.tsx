import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, apiPatch } from '../api/client';
import {
  Button, SecondaryButton, Input, Select, Badge, EmptyState, ErrorAlert, Modal, Textarea,
  statusColor, statusLabel, formatDateTime,
} from '../components/ui';

interface Publication {
  id: string;
  process_id: string;
  source: string | null;
  content: string;
  status: string;
  external_reference: string | null;
  possible_due_date: string | null;
  availability_date: string | null;
  publication_date: string | null;
  process_title: string | null;
  notes: string | null;
}

export default function Publications() {
  const [items, setItems] = useState<Publication[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [processes, setProcesses] = useState<Array<{ id: string; title: string }>>([]);
  const [form, setForm] = useState({ processId: '', source: '', content: '', externalReference: '', possibleDueDate: '', availabilityDate: '' });
  const [formError, setFormError] = useState<unknown>(null);
  const [captureStatus, setCaptureStatus] = useState<Array<{ name: string; configured: boolean }>>([]);
  const [capturing, setCapturing] = useState(false);
  const [captureResult, setCaptureResult] = useState<{ totalCreated: number; totalSkipped: number; runs: Array<{ adapter: string; status: string }> } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: Publication[] }>(`/api/publications${statusFilter ? `?status=${statusFilter}` : ''}`);
      setItems(res.items);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [statusFilter]);

  useEffect(() => {
    void apiGet<{ items: Array<{ id: string; title: string }> }>('/api/processes').then((r) => setProcesses(r.items)).catch(() => {});
    void apiGet<{ adapters: Array<{ name: string; configured: boolean }> }>('/api/capture/status').then((r) => setCaptureStatus(r.adapters)).catch(() => {});
  }, []);

  const runCapture = async () => {
    setCapturing(true);
    setCaptureResult(null);
    setError(null);
    try {
      const res = await apiPost<{ totalCreated: number; totalSkipped: number; runs: Array<{ adapter: string; status: string }> }>('/api/capture/run');
      setCaptureResult(res);
      void load();
    } catch (e) { setError(e); }
    finally { setCapturing(false); }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await apiPost('/api/publications', {
        processId: form.processId,
        source: form.source,
        content: form.content,
        externalReference: form.externalReference,
        possibleDueDate: form.possibleDueDate ? new Date(form.possibleDueDate).toISOString() : null,
        availabilityDate: form.availabilityDate ? new Date(form.availabilityDate).toISOString() : null,
      });
      setShowCreate(false);
      setForm({ processId: '', source: '', content: '', externalReference: '', possibleDueDate: '', availabilityDate: '' });
      void load();
    } catch (err) { setFormError(err); }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await apiPatch(`/api/publications/${id}`, { status });
      void load();
    } catch (err) { setFormError(err); }
  };

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200/80 pb-5">
        <h1 className="page-title">Intimações</h1>
        <div className="flex gap-2">
          {captureStatus.some((a) => a.configured) && (
            <SecondaryButton onClick={runCapture} disabled={capturing} className="shrink-0">
              {capturing ? 'Capturando…' : 'Importar dos tribunais'}
            </SecondaryButton>
          )}
          <Button onClick={() => setShowCreate(true)}>Registrar intimação</Button>
        </div>
      </div>

      {captureResult && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Captura concluída: {captureResult.totalCreated} nova(s) importada(s), {captureResult.totalSkipped} ignorada(s).
        </div>
      )}

      <div className="mb-4">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:max-w-48">
          <option value="">Todas</option>
          <option value="PENDING">Pendentes</option>
          <option value="READ">Lidas</option>
          <option value="PROCESSED">Processadas</option>
          <option value="CANCELLED">Canceladas</option>
        </Select>
      </div>

      <ErrorAlert error={error} />

      {loading ? (
        <div className="flex items-center gap-2.5 text-sm text-gray-500"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-brand-600" />Carregando…</div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhuma intimação registrada." hint="Registre intimações reais recebidas dos tribunais." />
      ) : (
        <div className="space-y-4">
          {items.map((p) => (
            <div key={p.id} className="surface p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {p.source ?? 'Intimação'}
                    <span className="ml-2"><Badge color={statusColor(p.status)}>{statusLabel(p.status)}</Badge></span>
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    Disponibilização: {formatDateTime(p.availability_date)}
                    {p.publication_date && <span> · Publicação: {formatDateTime(p.publication_date)}</span>}
                    {p.possible_due_date && <span> · Prazo: <b>{formatDateTime(p.possible_due_date)}</b></span>}
                  </div>
                  {p.process_title && p.process_id && (
                    <Link to={`/processos/${p.process_id}`} className="mt-1 inline-block text-sm link-quiet">
                      {p.process_title}
                    </Link>
                  )}
                </div>
                {p.status === 'PENDING' && (
                  <SecondaryButton onClick={() => updateStatus(p.id, 'PROCESSED')} className="px-3 py-1.5 text-xs">Marcar processada</SecondaryButton>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{p.content}</p>
              {p.external_reference && <div className="mt-1 text-xs text-gray-400">Ref externa: {p.external_reference}</div>}
              {p.notes && <div className="mt-1 text-xs text-gray-500">Obs: {p.notes}</div>}
            </div>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Registrar intimação">
        <form onSubmit={create} className="space-y-4">
          <ErrorAlert error={formError} />
          <div>
            <label className="field-label">Processo *</label>
            <Select value={form.processId} onChange={(e) => setForm({ ...form, processId: e.target.value })} required>
              <option value="">Selecione…</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </Select>
          </div>
          <div>
            <label className="field-label">Origem</label>
            <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Ex.: DJSP, e-SAJ…" />
          </div>
          <div>
            <label className="field-label">Data de disponibilização</label>
            <Input type="datetime-local" value={form.availabilityDate} onChange={(e) => setForm({ ...form, availabilityDate: e.target.value })} />
          </div>
          <div>
            <label className="field-label">Conteúdo *</label>
            <Textarea rows={6} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required />
          </div>
          <div>
            <label className="field-label">Referência externa</label>
            <Input value={form.externalReference} onChange={(e) => setForm({ ...form, externalReference: e.target.value })} />
          </div>
          <div>
            <label className="field-label">Prazo possível</label>
            <Input type="datetime-local" value={form.possibleDueDate} onChange={(e) => setForm({ ...form, possibleDueDate: e.target.value })} />
          </div>
          <Button type="submit" className="w-full">Registrar</Button>
        </form>
      </Modal>
    </div>
  );
}