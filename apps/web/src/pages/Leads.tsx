import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch } from '../api/client';
import {
  Button, Input, Select, Badge, EmptyState, ErrorAlert, Modal, statusColor, statusLabel, formatDateTime,
} from '../components/ui';

interface Lead {
  id: string;
  name: string;
  phone: string | null;
  source: string | null;
  subject: string | null;
  status: string;
  assigned_name: string | null;
  converted_client_id: string | null;
  created_at: string;
}

export default function Leads() {
  const [items, setItems] = useState<Lead[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', source: '', subject: '' });
  const [formError, setFormError] = useState<unknown>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: Lead[] }>(`/api/leads${statusFilter ? `?status=${statusFilter}` : ''}`);
      setItems(res.items);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [statusFilter]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await apiPost('/api/leads', form);
      setShowCreate(false);
      setForm({ name: '', phone: '', source: '', subject: '' });
      void load();
    } catch (err) { setFormError(err); }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await apiPatch(`/api/leads/${id}`, { status });
      void load();
    } catch (err) { setFormError(err); }
  };

  const convert = async (id: string, name: string) => {
    if (!confirm(`Converter o lead "${name}" em cliente?`)) return;
    try {
      await apiPost(`/api/leads/${id}/convert`, { clientName: name });
      void load();
    } catch (err) { setFormError(err); }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Leads</h1>
        <Button onClick={() => setShowCreate(true)}>Novo lead</Button>
      </div>

      <div className="mb-4">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-44">
          <option value="">Todos</option>
          <option value="NEW">Novo</option>
          <option value="CONTACTED">Contatado</option>
          <option value="QUALIFIED">Qualificado</option>
          <option value="PROPOSAL">Proposta</option>
          <option value="WON">Ganho</option>
          <option value="LOST">Perdido</option>
        </Select>
      </div>

      <ErrorAlert error={error} />

      {loading ? (
        <div className="text-gray-500">Carregando…</div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhum lead cadastrado." hint="Crie leads manualmente. A entrada automática via WhatsApp será preparada futuramente." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((l) => (
            <div key={l.id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="font-medium">{l.name}</div>
                <Badge color={statusColor(l.status)}>{statusLabel(l.status)}</Badge>
              </div>
              {l.phone && <div className="mt-1 text-sm text-gray-500">{l.phone}</div>}
              {l.subject && <div className="mt-1 text-sm text-gray-600">{l.subject}</div>}
              {l.source && <div className="mt-1 text-xs text-gray-400">Origem: {l.source}</div>}
              <div className="mt-2 text-xs text-gray-400">{formatDateTime(l.created_at)}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {l.converted_client_id ? (
                  <Badge color="green">Convertido em cliente</Badge>
                ) : (
                  <>
                    <button onClick={() => updateStatus(l.id, l.status === 'NEW' ? 'CONTACTED' : 'QUALIFIED')} className="text-xs text-brand-600 hover:underline">Avançar status</button>
                    <button onClick={() => convert(l.id, l.name)} className="text-xs text-green-600 hover:underline">Converter em cliente</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Novo lead">
        <form onSubmit={create} className="space-y-3">
          <ErrorAlert error={formError} />
          <div>
            <label className="mb-1 block text-sm font-medium">Nome *</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Telefone</label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Origem</label>
            <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Ex.: WhatsApp, indicação…" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Assunto</label>
            <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </div>
          <Button type="submit" className="w-full">Criar</Button>
        </form>
      </Modal>
    </div>
  );
}