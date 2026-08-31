import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from '../api/client';
import { Button, Input, EmptyState, ErrorAlert, Modal } from '../components/ui';

interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  cpf_cnpj: string | null;
  case_count: number;
}

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', cpfCnpj: '', notes: '' });
  const [formError, setFormError] = useState<unknown>(null);

  const load = async (term = '') => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: Client[] }>(`/api/clients?search=${encodeURIComponent(term)}`);
      setClients(res.items);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await apiPost('/api/clients', form);
      setShowCreate(false);
      setForm({ name: '', email: '', phone: '', cpfCnpj: '', notes: '' });
      await load(search);
    } catch (err) {
      setFormError(err);
    }
  };

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200/80 pb-5">
        <h1 className="page-title">Clientes</h1>
        <Button onClick={() => setShowCreate(true)}>Novo Cliente</Button>
      </div>

      <div className="mb-4">
        <Input
          placeholder="Buscar por nome, email, telefone ou CPF/CNPJ…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void load(search)}
        />
      </div>

      <ErrorAlert error={error} />

      {loading ? (
        <div className="flex items-center gap-2.5 text-sm text-gray-500"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-brand-600" />Carregando…</div>
      ) : clients.length === 0 ? (
        <EmptyState title="Nenhum cliente cadastrado." hint="Crie seu primeiro cliente para começar." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <Link
              key={c.id}
              to={`/clientes/${c.id}`}
              className="group surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-elevated"
            >
              <div className="font-medium">{c.name}</div>
              {c.email && <div className="mt-1 text-sm text-gray-500">{c.email}</div>}
              {c.phone && <div className="text-sm text-gray-500">{c.phone}</div>}
              {c.cpf_cnpj && <div className="text-sm text-gray-500">{c.cpf_cnpj}</div>}
              <div className="mt-2 text-xs text-gray-400">{c.case_count} processo(s)</div>
            </Link>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Novo Cliente">
        <form onSubmit={handleCreate} className="space-y-4">
          <ErrorAlert error={formError} />
          <div>
            <label className="field-label">Nome *</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="field-label">Email</label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="field-label">Telefone</label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="field-label">CPF/CNPJ</label>
            <Input value={form.cpfCnpj} onChange={(e) => setForm({ ...form, cpfCnpj: e.target.value })} />
          </div>
          <div>
            <label className="field-label">Observações</label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <Button type="submit" className="w-full">Criar</Button>
        </form>
      </Modal>
    </div>
  );
}