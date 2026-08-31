import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Card, Badge, EmptyState, ErrorAlert, Button, SecondaryButton, Input } from '../components/ui';

interface SuperAdminStatus {
  ok: boolean;
  version: string;
  environment: string;
  storage: string;
  ai: { provider: string; configured: boolean };
  counts: { organizations: number; users: number; clients: number; cases: number };
}

export default function SuperAdmin() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SuperAdminStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ orgName: '', adminName: '', adminEmail: '', adminPassword: '' });
  const [bootstrapError, setBootstrapError] = useState<unknown>(null);
  const [bootstrapMsg, setBootstrapMsg] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiGet<SuperAdminStatus>('/api/superadmin/status');
      setStatus(res);
    } catch (e) { setError(e); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const bootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setBootstrapError(null);
    setBootstrapMsg('');
    setBusy(true);
    try {
      const res = await apiPost<{ organization: { id: string; name: string }; admin: { id: string; email: string; name: string } }>('/api/superadmin/bootstrap', form);
      setBootstrapMsg(`Instalação criada: organização "${res.organization.name}" e admin "${res.admin.email}".`);
      setForm({ orgName: '', adminName: '', adminEmail: '', adminPassword: '' });
      void load();
    } catch (err) { setBootstrapError(err); }
    finally { setBusy(false); }
  };

  const doLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (!user?.isSuperAdmin) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <div>
            <div className="eyebrow">Camada técnica</div>
            <h1 className="font-display text-lg font-semibold text-gray-900">Painel do Implantador</h1>
          </div>
          <div className="flex items-center gap-3">
            <Badge color="purple">SUPER ADMIN</Badge>
            <button onClick={() => void doLogout()} className="text-sm text-gray-500 hover:text-gray-900">Sair</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-5 py-4">
          <div>
            <div className="font-display text-sm font-semibold text-brand-900">Assistente de implantação</div>
            <div className="text-xs text-brand-700">Fluxo guiado de 12 etapas para preparar a instalação.</div>
          </div>
          <Button onClick={() => navigate('/superadmin/install')}>Nova implantação</Button>
        </div>

        <Card title="Status da instalação" action={<SecondaryButton className="px-3 py-1.5 text-xs" onClick={() => void load()}>Atualizar</SecondaryButton>}>
          <ErrorAlert error={error} />
          {status ? (
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-gray-500">Versão</dt><dd className="font-medium">{status.version}</dd></div>
              <div><dt className="text-xs text-gray-500">Ambiente</dt><dd className="font-medium">{status.environment}</dd></div>
              <div><dt className="text-xs text-gray-500">Storage</dt><dd className="font-medium">{status.storage}</dd></div>
              <div><dt className="text-xs text-gray-500">IA</dt><dd className="font-medium">{status.ai.provider}{status.ai.configured ? '' : ' (não configurado)'}</dd></div>
              <div><dt className="text-xs text-gray-500">Organizações</dt><dd className="font-medium">{status.counts.organizations}</dd></div>
              <div><dt className="text-xs text-gray-500">Usuários</dt><dd className="font-medium">{status.counts.users}</dd></div>
              <div><dt className="text-xs text-gray-500">Clientes</dt><dd className="font-medium">{status.counts.clients}</dd></div>
              <div><dt className="text-xs text-gray-500">Processos</dt><dd className="font-medium">{status.counts.cases}</dd></div>
            </dl>
          ) : (
            <EmptyState title="Carregando status…" />
          )}
        </Card>

        <Card title="Bootstrap de instalação">
          <p className="mb-4 text-xs text-gray-500">
            Cria a organização e o primeiro administrador (ADMIN + LAWYER). O SUPER ADMIN permanece fora da organização.
          </p>
          <ErrorAlert error={bootstrapError} />
          {bootstrapMsg && <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{bootstrapMsg}</div>}
          <form onSubmit={bootstrap} className="space-y-4">
            <div>
              <label className="field-label">Nome da organização *</label>
              <Input value={form.orgName} onChange={(e) => setForm({ ...form, orgName: e.target.value })} placeholder="João Silva Advocacia" required />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label">Nome do administrador *</label>
                <Input value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} placeholder="João Silva" required />
              </div>
              <div>
                <label className="field-label">Email do administrador *</label>
                <Input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} placeholder="joao@email.com" required />
              </div>
            </div>
            <div>
              <label className="field-label">Senha do administrador *</label>
              <Input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} placeholder="mínimo 8 caracteres" required minLength={8} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Criando…' : 'Criar organização e administrador'}</Button>
          </form>
        </Card>
      </main>
    </div>
  );
}