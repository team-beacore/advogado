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
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Processos</h1>
        <Button onClick={() => setShowCreate(true)}>Novo Processo</Button>
      </div>

      <div className="mb-4 flex gap-3">
        <Input
          placeholder="Buscar por título ou número…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void load()}
          className="max-w-sm"
        />
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="max-w-40">
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
        <div className="text-gray-500">Carregando…</div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhum processo encontrado." hint="Crie seu primeiro processo." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <Link
                key={p.id}
                to={`/processos/${p.id}`}
                className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm hover:border-brand-300"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{p.title}</div>
                  <Badge color={statusColor(p.status)}>{statusLabel(p.status)}</Badge>
                </div>
                {p.process_number && <div className="mt-1 text-xs text-gray-500">{p.process_number}</div>}
                {p.client_name && <div className="mt-1 text-sm text-gray-600">{p.client_name}</div>}
                <div className="mt-2 flex gap-3 text-xs text-gray-400">
                  <span>{p.document_count} docs</span>
                  <span>{p.open_task_count} tarefas</span>
                  {p.pending_publication_count > 0 && <span className="text-yellow-600">{p.pending_publication_count} intimações</span>}
                </div>
              </Link>
            ))}
          </div>
          {total > 20 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
              <span>{total} processo(s)</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="disabled:opacity-30">Anterior</button>
                <span>{page}</span>
                <button disabled={page * 20 >= total} onClick={() => setPage(page + 1)} className="disabled:opacity-30">Próxima</button>
              </div>
            </div>
          )}
        </>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Novo Processo">
        <form onSubmit={handleCreate} className="space-y-3">
          <ErrorAlert error={formError} />
          <div>
            <label className="mb-1 block text-sm font-medium">Cliente</label>
            <Select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
              <option value="">Sem cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Título *</label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Número do processo</label>
            <Input value={form.processNumber} onChange={(e) => setForm({ ...form, processNumber: e.target.value })} placeholder="Ex.: 1234567-89.2024.8.01.0001" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Tribunal</label>
              <Input value={form.court} onChange={(e) => setForm({ ...form, court: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Área</label>
              <Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Descrição</label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <Button type="submit" className="w-full">Criar</Button>
        </form>
      </Modal>
    </div>
  );
}