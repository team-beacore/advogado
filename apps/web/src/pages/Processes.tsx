import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from '../api/client';
import {
  Button, Input, Select, Badge, EmptyState, ErrorAlert, Modal, statusColor, statusLabel,
} from '../components/ui';

interface ProcessItem {
  id: string;
  title: string;
  process_number: string | null;
  court: string | null;
  area: string | null;
  status: string;
  client_name: string | null;
  responsible_name: string | null;
  document_count: number;
  pending_publication_count: number;
  open_task_count: number;
  created_at: string;
}

export default function Processes() {
  const [items, setItems] = useState<ProcessItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', clientId: '', processNumber: '', court: '', area: '', description: '' });
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [formError, setFormError] = useState<unknown>(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      const res = await apiGet<{ items: ProcessItem[]; total: number }>(`/api/processes?${params}`);
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [page, statusFilter]);

  useEffect(() => {
    void apiGet<{ items: Array<{ id: string; name: string }> }>('/api/clients').then((r) => setClients(r.items)).catch(() => {});
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await apiPost('/api/processes', { ...form, clientId: form.clientId || null });
      setShowCreate(false);
      setForm({ title: '', clientId: '', processNumber: '', court: '', area: '', description: '' });
      setPage(1);
      void load();
    } catch (err) {
      setFormError(err);
    }
  };

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200/80 pb-5">
        <h1 className="page-title">Processos</h1>
        <Button onClick={() => setShowCreate(true)}>Novo Processo</Button>
      </div>

      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-gray-200/90 bg-white p-3 shadow-card sm:flex-row sm:items-center">
        <Input
          placeholder="Buscar por título ou número…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void load()}
          className="sm:max-w-sm"
        />
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="sm:max-w-44">
          <option value="">Todos</option>
          <option value="ACTIVE">Ativo</option>
          <option value="SUSPENDED">Suspenso</option>
          <option value="ARCHIVED">Arquivado</option>
          <option value="CLOSED">Encerrado</option>
          <option value="DRAFT">Rascunho</option>
        </Select>
      </div>

      <ErrorAlert error={error} />

      {loading ? (
        <div className="flex items-center gap-2.5 text-sm text-gray-500"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-brand-600" />Carregando…</div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhum processo encontrado." hint="Crie seu primeiro processo." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <Link
                key={p.id}
                to={`/processos/${p.id}`}
                className="group surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-elevated"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-display text-[0.95rem] font-semibold leading-snug tracking-tight text-gray-900">{p.title}</div>
                  <Badge color={statusColor(p.status)}>{statusLabel(p.status)}</Badge>
                </div>
                {p.process_number && <div className="mt-1 text-xs text-gray-500">{p.process_number}</div>}
                {p.client_name && <div className="mt-1 text-sm text-gray-600">{p.client_name}</div>}
                <div className="mt-3.5 flex flex-wrap gap-3 border-t border-gray-100 pt-3 text-xs font-medium text-gray-400">
                  <span>{p.document_count} docs</span>
                  <span>{p.open_task_count} tarefas</span>
                  {p.pending_publication_count > 0 && <span className="text-warning-600">{p.pending_publication_count} intimações</span>}
                </div>
              </Link>
            ))}
          </div>
          {total > 20 && (
            <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-gray-200/90 bg-white px-4 py-3 text-sm text-gray-500 shadow-card">
              <span>{total} processo(s)</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-35">Anterior</button>
                <span>{page}</span>
                <button disabled={page * 20 >= total} onClick={() => setPage(page + 1)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-35">Próxima</button>
              </div>
            </div>
          )}
        </>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Novo Processo">
        <form onSubmit={handleCreate} className="space-y-4">
          <ErrorAlert error={formError} />
          <div>
            <label className="field-label">Cliente</label>
            <Select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
              <option value="">Sem cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="field-label">Título *</label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div>
            <label className="field-label">Número do processo</label>
            <Input value={form.processNumber} onChange={(e) => setForm({ ...form, processNumber: e.target.value })} placeholder="Ex.: 1234567-89.2024.8.01.0001" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Tribunal</label>
              <Input value={form.court} onChange={(e) => setForm({ ...form, court: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Área</label>
              <Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="field-label">Descrição</label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <Button type="submit" className="w-full">Criar</Button>
        </form>
      </Modal>
    </div>
  );
}