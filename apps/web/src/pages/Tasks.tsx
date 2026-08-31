import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, apiPatch } from '../api/client';
import {
  Button, SecondaryButton, Input, Select, Badge, EmptyState, ErrorAlert, Modal, Textarea,
  statusColor, statusLabel, formatDate,
} from '../components/ui';

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  assigned_name: string | null;
  process_title: string | null;
  process_id: string | null;
}

interface Summary { today: number; overdue: number; upcoming: number; done: number; }

const views = [
  { key: 'today', label: 'Hoje' },
  { key: 'overdue', label: 'Atrasadas' },
  { key: 'upcoming', label: 'Próximas' },
  { key: 'done', label: 'Concluídas' },
];

export default function Tasks() {
  const [view, setView] = useState('today');
  const [items, setItems] = useState<Task[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [processes, setProcesses] = useState<Array<{ id: string; title: string }>>([]);
  const [form, setForm] = useState({ title: '', processId: '', description: '', priority: 'MEDIUM', dueDate: '' });
  const [formError, setFormError] = useState<unknown>(null);

  const load = async (v = view) => {
    setLoading(true);
    setError(null);
    try {
      const [itemsRes, summaryRes] = await Promise.all([
        apiGet<{ items: Task[] }>(`/api/tasks?view=${v}`),
        apiGet<Summary>('/api/tasks/summary'),
      ]);
      setItems(itemsRes.items);
      setSummary(summaryRes);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [view]);

  useEffect(() => {
    void apiGet<{ items: Array<{ id: string; title: string }> }>('/api/processes').then((r) => setProcesses(r.items)).catch(() => {});
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await apiPost('/api/tasks', {
        title: form.title,
        processId: form.processId || null,
        description: form.description,
        priority: form.priority,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      });
      setShowCreate(false);
      setForm({ title: '', processId: '', description: '', priority: 'MEDIUM', dueDate: '' });
      void load();
    } catch (err) { setFormError(err); }
  };

  const updateStatus = async (taskId: string, status: string) => {
    try {
      await apiPatch(`/api/tasks/${taskId}`, { status });
      void load();
    } catch (err) { setFormError(err); }
  };

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200/80 pb-5">
        <h1 className="page-title">Tarefas</h1>
        <Button onClick={() => setShowCreate(true)}>Nova tarefa</Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-xs text-gray-500">Hoje</div>
          <div className="font-display text-2xl font-semibold text-gray-900">{summary?.today ?? '—'}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-xs text-gray-500">Atrasadas</div>
          <div className="font-display text-2xl font-semibold text-danger-600">{summary?.overdue ?? '—'}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-xs text-gray-500">Próximas</div>
          <div className="font-display text-2xl font-semibold text-gray-900">{summary?.upcoming ?? '—'}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-xs text-gray-500">Concluídas</div>
          <div className="font-display text-2xl font-semibold text-success-600">{summary?.done ?? '—'}</div>
        </div>
      </div>

      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {views.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${view === v.key ? 'border-brand-700 text-brand-800' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <ErrorAlert error={error} />

      {loading ? (
        <div className="flex items-center gap-2.5 text-sm text-gray-500"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-brand-600" />Carregando…</div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhuma tarefa nesta visão." />
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">{t.title}</div>
                {t.description && <div className="mt-0.5 text-sm leading-relaxed text-gray-500">{t.description}</div>}
                <div className="mt-0.5 flex gap-2 text-xs text-gray-400">
                  <Badge color={statusColor(t.priority)}>{statusLabel(t.priority)}</Badge>
                  <Badge color={statusColor(t.status)}>{statusLabel(t.status)}</Badge>
                  {t.due_date && <span>Prazo: {formatDate(t.due_date)}</span>}
                  {t.process_title && t.process_id && (
                    <Link to={`/processos/${t.process_id}`} className="link-quiet">{t.process_title}</Link>
                  )}
                  {t.assigned_name && <span>· {t.assigned_name}</span>}
                </div>
              </div>
              {t.status === 'TODO' || t.status === 'IN_PROGRESS' ? (
                <SecondaryButton onClick={() => updateStatus(t.id, 'DONE')} className="px-3 py-1.5 text-xs">Concluir</SecondaryButton>
              ) : (
                <button onClick={() => updateStatus(t.id, 'TODO')} className="text-xs font-medium text-gray-500 underline-offset-4 transition-colors hover:text-gray-800 hover:underline">Reabrir</button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nova tarefa">
        <form onSubmit={create} className="space-y-4">
          <ErrorAlert error={formError} />
          <div>
            <label className="field-label">Título *</label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div>
            <label className="field-label">Processo</label>
            <Select value={form.processId} onChange={(e) => setForm({ ...form, processId: e.target.value })}>
              <option value="">Sem processo</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </Select>
          </div>
          <div>
            <label className="field-label">Descrição</label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Prioridade</label>
              <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="LOW">Baixa</option>
                <option value="MEDIUM">Média</option>
                <option value="HIGH">Alta</option>
                <option value="CRITICAL">Crítica</option>
              </Select>
            </div>
            <div>
              <label className="field-label">Prazo</label>
              <Input type="datetime-local" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </div>
          </div>
          <Button type="submit" className="w-full">Criar</Button>
        </form>
      </Modal>
    </div>
  );
}