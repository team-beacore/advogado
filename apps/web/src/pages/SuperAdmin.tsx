import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Card, Badge, EmptyState, ErrorAlert, Button, SecondaryButton } from '../components/ui';

interface SuperAdminStatus {
  ok: boolean;
  version: string;
  environment: string;
  database: boolean;
  storage: { driver: string; ok: boolean };
  migrations: number;
  ai: { provider: string; configured: boolean };
  services: { api: boolean; database: boolean; storage: boolean; migrations: boolean };
  counts: { organizations: number; users: number };
}

interface InstallationItem {
  id: string;
  name: string;
  plan: 'SOLO' | 'OFFICE';
  createdAt: string;
  lastValidationAt: string | null;
  ready: boolean;
  stepSummary: Record<string, unknown>;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function SuperAdmin() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SuperAdminStatus | null>(null);
  const [installations, setInstallations] = useState<InstallationItem[]>([]);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [st, ins] = await Promise.all([
        apiGet<SuperAdminStatus>('/api/superadmin/status'),
        apiGet<{ installations: InstallationItem[] }>('/api/superadmin/installations').catch(() => ({ installations: [] })),
      ]);
      setStatus(st);
      setInstallations(ins.installations);
    } catch (e) { setError(e); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const doLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (!user?.isSuperAdmin) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
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

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        {/* Assistente de implantação */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-brand-200 bg-brand-50 px-5 py-5">
          <div>
            <div className="font-display text-base font-semibold text-brand-900">Assistente de implantação</div>
            <div className="text-sm text-brand-700">Prepare uma nova instalação da Plataforma Jurídica.</div>
          </div>
          <Button onClick={() => navigate('/superadmin/install')} className="whitespace-nowrap">+ Nova implantação</Button>
        </div>

        {/* Instalações existentes */}
        {installations.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-gray-500">Instalação</h2>
            {installations.map((inst) => (
              <Card key={inst.id} action={
                <SecondaryButton className="px-3 py-1.5 text-xs" onClick={() => navigate('/superadmin/install')}>Ver detalhes</SecondaryButton>
              }>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="font-display text-base font-semibold text-gray-900">{inst.name}</div>
                    <div className="mt-1 text-sm text-gray-500">Plano: <b className="text-gray-700">{inst.plan}</b></div>
                    <div className="mt-0.5 text-sm text-gray-500">
                      Status: {inst.ready ? <span className="font-semibold text-green-700">Operacional</span> : <span className="font-semibold text-yellow-700">Em implantação</span>}
                    </div>
                    <div className="mt-0.5 text-sm text-gray-500">Última validação: {formatDateTime(inst.lastValidationAt ?? inst.createdAt)}</div>
                  </div>
                  <Badge color={inst.ready ? 'green' : 'yellow'}>{inst.ready ? 'Operacional' : 'Em implantação'}</Badge>
                </div>
              </Card>
            ))}
          </section>
        )}

        {/* Status da instalação */}
        <Card title="Status da instalação" action={<SecondaryButton className="px-3 py-1.5 text-xs" onClick={() => void load()}>Atualizar</SecondaryButton>}>
          <ErrorAlert error={error} />
          {status ? (
            <>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-gray-500">Versão</dt><dd className="font-medium">{status.version}</dd></div>
                <div><dt className="text-xs text-gray-500">Ambiente</dt><dd className="font-medium">{status.environment}</dd></div>
                <div><dt className="text-xs text-gray-500">Banco</dt><dd className="font-medium">{status.database ? 'conectado' : 'indisponível'}</dd></div>
                <div><dt className="text-xs text-gray-500">Storage</dt><dd className="font-medium">{status.storage.driver} {status.storage.ok ? '(ok)' : '(falha)'}</dd></div>
                <div><dt className="text-xs text-gray-500">Migrations</dt><dd className="font-medium">{status.migrations} aplicadas</dd></div>
                <div><dt className="text-xs text-gray-500">IA</dt><dd className="font-medium">{status.ai.provider}{status.ai.configured ? ' (configurado)' : ' (não configurado)'}</dd></div>
                <div><dt className="text-xs text-gray-500">Organizações</dt><dd className="font-medium">{status.counts.organizations}</dd></div>
                <div><dt className="text-xs text-gray-500">Usuários</dt><dd className="font-medium">{status.counts.users}</dd></div>
              </dl>
              <div className="mt-4 rounded-lg border border-gray-200 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Status dos serviços</div>
                <div className="flex flex-wrap gap-2">
                  <Badge color={status.services.api ? 'green' : 'red'}>API {status.services.api ? 'OK' : 'FALHA'}</Badge>
                  <Badge color={status.services.database ? 'green' : 'red'}>Banco {status.services.database ? 'OK' : 'FALHA'}</Badge>
                  <Badge color={status.services.storage ? 'green' : 'red'}>Storage {status.services.storage ? 'OK' : 'FALHA'}</Badge>
                  <Badge color={status.services.migrations ? 'green' : 'red'}>Migrations {status.services.migrations ? 'OK' : 'FALHA'}</Badge>
                </div>
              </div>
            </>
          ) : (
            <EmptyState title="Carregando status…" />
          )}
        </Card>
      </main>
    </div>
  );
}
