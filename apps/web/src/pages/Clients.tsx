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
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Clientes</h1>
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
        <div className="text-gray-500">Carregando…</div>
      ) : clients.length === 0 ? (
        <EmptyState title="Nenhum cliente cadastrado." hint="Crie seu primeiro cliente para começar." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <Link
              key={c.id}
              to={`/clientes/${c.id}`}
              className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm hover:border-brand-300"
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
        <form onSubmit={handleCreate} className="space-y-3">
          <ErrorAlert error={formError} />
          <div>
            <label className="mb-1 block text-sm font-medium">Nome *</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Telefone</label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">CPF/CNPJ</label>
            <Input value={form.cpfCnpj} onChange={(e) => setForm({ ...form, cpfCnpj: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Observações</label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <Button type="submit" className="w-full">Criar</Button>
        </form>
      </Modal>
    </div>
  );
}