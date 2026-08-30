import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const nav = [
  { to: '/', label: 'Visão Geral', end: true },
  { to: '/processos', label: 'Processos' },
  { to: '/clientes', label: 'Clientes' },
  { to: '/tarefas', label: 'Tarefas' },
  { to: '/intimacoes', label: 'Intimações' },
  { to: '/documentos', label: 'Documentos' },
  { to: '/leads', label: 'Leads' },
  { to: '/financeiro', label: 'Financeiro' },
  { to: '/configuracoes', label: 'Configurações' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-gray-200 bg-white">
        <div className="px-5 py-4 text-lg font-semibold text-brand-700">Plataforma Jurídica</div>
        <nav className="mt-2 flex flex-col gap-0.5 px-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
          <div className="text-sm text-gray-500">
            {user?.name} · {user?.role ?? 'sem organização'}
          </div>
          <button
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            Sair
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
