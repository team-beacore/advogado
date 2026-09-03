import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

type IconProps = { className?: string };

const Icon = ({ path, className = '' }: { path: string } & IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`h-[18px] w-[18px] shrink-0 ${className}`}
    aria-hidden="true"
  >
    <path d={path} />
  </svg>
);

const icons: Record<string, string> = {
  overview: 'M4 13h6V4H4v9Zm10 7h6v-9h-6v9ZM4 20h6v-4H4v4Zm10-11h6V4h-6v5Z',
  processes: 'M7 4h7l4 4v12H7V4Zm7 0v4h4M10 12h6M10 16h4',
  clients: 'M16 19v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V19M9.5 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM17 11a2.5 2.5 0 1 0 0-5M21 19v-1a3.5 3.5 0 0 0-3-3.45',
  tasks: 'M9 5h10M9 12h10M9 19h10M4 5l1.2 1.2L7.5 4M4 12l1.2 1.2L7.5 11M4 19l1.2 1.2L7.5 18',
  publications: 'M3 8.5 12 14l9-5.5M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
  documents: 'M6 3h7l5 5v13H6V3Zm7 0v5h5M9 13h6M9 17h6',
  monitoring: 'M21 12a9 9 0 1 1-9-9M21 3l-9 9-2.5-2.5M16 3h5v5',
  leads: 'M4 18l5-5 3.5 3.5L20 9M20 9h-4.5M20 9v4.5',
  finance: 'M12 3v18M8.5 7.5h6.2a2.4 2.4 0 0 1 0 4.8H9.3a2.4 2.4 0 0 0 0 4.8h6.2',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm8-3.2-1.7-.6-.5-1.2.8-1.6-1.7-1.7-1.6.8-1.2-.5L13.5 5h-2.4l-.6 1.7-1.2.5-1.6-.8L6 8.1l.8 1.6-.5 1.2L4.6 11.5v2.4l1.7.6.5 1.2-.8 1.6 1.7 1.7 1.6-.8 1.2.5.6 1.7h2.4l.6-1.7 1.2-.5 1.6.8 1.7-1.7-.8-1.6.5-1.2 1.7-.6v-2.4Z',
};

const nav: Array<{ to: string; label: string; icon: string; group: string; end?: boolean; perm?: string; plan?: 'SOLO' | 'OFFICE' }> = [
  { to: '/', label: 'Visão Geral', end: true, icon: 'overview', group: 'Painel' },
  { to: '/processos', label: 'Processos', icon: 'processes', group: 'Operação', perm: 'processes.read' },
  { to: '/monitoramento', label: 'Monitoramento', icon: 'monitoring', group: 'Operação', perm: 'processes.read' },
  { to: '/descoberta', label: 'Descoberta', icon: 'processes', group: 'Operação', perm: 'process_discovery.view' },
  { to: '/clientes', label: 'Clientes', icon: 'clients', group: 'Operação', perm: 'clients.read' },
  { to: '/tarefas', label: 'Tarefas', icon: 'tasks', group: 'Operação', perm: 'tasks.read' },
  { to: '/intimacoes', label: 'Intimações', icon: 'publications', group: 'Operação', perm: 'publications.read' },
  { to: '/documentos', label: 'Documentos', icon: 'documents', group: 'Operação', perm: 'documents.read' },
  { to: '/leads', label: 'Leads', icon: 'leads', group: 'Gestão', perm: 'leads.read' },
  { to: '/financeiro', label: 'Financeiro', icon: 'finance', group: 'Gestão', perm: 'billing.read' },
  { to: '/equipe', label: 'Equipe', icon: 'clients', group: 'Gestão', perm: 'team.manage', plan: 'OFFICE' },
  { to: '/configuracoes', label: 'Configurações', icon: 'settings', group: 'Gestão', perm: 'settings.manage' },
];

const groups = ['Painel', 'Operação', 'Gestão'];

function canSee(item: { perm?: string; plan?: 'SOLO' | 'OFFICE' }, permissions: string[], organizationType: 'SOLO' | 'OFFICE' | null): boolean {
  if (item.plan && organizationType !== item.plan) return false;
  if (!item.perm) return true;
  return permissions.includes(item.perm);
}

function initials(name?: string | null): string {
  if (!name) return '—';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col bg-brand-950 text-gray-300">
      <div className="flex items-center gap-3 border-b border-white/5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-b from-brand-700 to-brand-900 ring-1 ring-inset ring-gold-300/30">
          <svg viewBox="0 0 24 24" fill="none" stroke="#d8c188" strokeWidth="1.5" strokeLinecap="round" className="h-[18px] w-[18px]">
            <path d="M12 4v16M6 20h12M4 9h8L8 15 4 9Zm12 0h4l-2 4-2-4Z" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="truncate font-display text-[0.95rem] font-semibold tracking-tight text-white">Plataforma Jurídica</div>
          <div className="truncate text-[10px] uppercase tracking-[0.18em] text-gold-300/70">Gestão de escritório</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-5">
        {groups.map((group) => (
          <div key={group} className="mb-5 last:mb-0">
            <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">{group}</div>
            <div className="flex flex-col gap-0.5">
              {nav
                .filter((item) => item.group === group && canSee(item, user?.permissions ?? [], user?.organizationType ?? null))
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                        isActive
                          ? 'bg-white/[0.07] text-white'
                          : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-100'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gold-300 transition-opacity duration-200 ${
                            isActive ? 'opacity-100' : 'opacity-0'
                          }`}
                        />
                        <Icon path={icons[item.icon]} className={isActive ? 'text-gold-300' : 'text-current opacity-80'} />
                        <span className="truncate">{item.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/5 px-5 py-4 text-[11px] leading-relaxed text-white/30">
        Ambiente seguro · dados criptografados
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="hidden w-[248px] shrink-0 lg:block">
        <div className="fixed inset-y-0 left-0 w-[248px]">{sidebar}</div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-gray-950/50 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[264px] animate-fade-in shadow-elevated">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-gray-200/80 bg-white/85 backdrop-blur-md">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 sm:px-6 lg:py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setMobileOpen(true)}
                aria-label="Abrir menu"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 lg:hidden"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="h-[18px] w-[18px]">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
              <div className="min-w-0">
                <div className="truncate font-display text-sm font-semibold tracking-tight text-gray-900">
                  {user?.name ?? '—'}
                </div>
                <div className="truncate text-[11px] uppercase tracking-[0.12em] text-gray-400">
                  {user?.role ?? 'sem organização'}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 font-display text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
                {initials(user?.name)}
              </div>
              <span className="hidden h-6 w-px bg-gray-200 sm:block" />
              <button
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
                className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                Sair
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
