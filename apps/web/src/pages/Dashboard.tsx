import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client';
import { Card, Badge, EmptyState, statusColor, statusLabel, formatDateTime } from '../components/ui';

interface DashboardData {
  counts: {
    activeCases: number;
    pendingTasks: number;
    overdueTasks: number;
    pendingPublications: number;
  };
  todayTasks: Array<Record<string, unknown>>;
  upcomingTasks: Array<Record<string, unknown>>;
  recentActivities: Array<Record<string, unknown>>;
  finance: {
    receivableTotal: number;
    receivableCount: number;
    receivedTotal: number;
  };
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [identityMissing, setIdentityMissing] = useState(false);
  const [identityChecked, setIdentityChecked] = useState(false);

  useEffect(() => {
    apiGet<DashboardData>('/api/dashboard')
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    apiGet<{ identity: { id: string } | null }>('/api/professional-identity/me')
      .then((r) => setIdentityMissing(!r.identity))
      .catch(() => { /* identidade indisponível */ })
      .finally(() => setIdentityChecked(true));
  }, []);

  if (error) return <div className="rounded-lg border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</div>;
  if (!data) return <div className="flex items-center gap-2.5 text-sm text-gray-500"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-brand-600" />Carregando…</div>;

  const hasData = data.counts.activeCases + data.counts.pendingTasks + data.counts.pendingPublications > 0;

  const finance = data.finance ?? { receivableTotal: 0, receivableCount: 0, receivedTotal: 0 };
  const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const identityBanner = identityChecked && identityMissing && (
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <b>Configure seu perfil profissional.</b> Cadastre sua OAB/UF no <Link to="/perfil" className="font-semibold text-amber-900 underline underline-offset-2">Perfil</Link> para habilitar a Descoberta de processos.
    </div>
  );

  if (!hasData && finance.receivableCount === 0) {
    return (
      <div>
        <h1 className="page-title mb-6">Visão Geral</h1>
        {identityBanner}
        <EmptyState title="Nenhum processo cadastrado." hint="Comece criando seu primeiro cliente e processo." />
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title mb-6">Visão Geral</h1>
      {identityBanner}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/processos" className="group surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-elevated">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Processos ativos</div>
          <div className="mt-1.5 font-display text-[1.9rem] font-semibold tracking-tightest text-gray-900">{data.counts.activeCases}</div>
        </Link>
        <Link to="/tarefas" className="group surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-elevated">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Tarefas pendentes</div>
          <div className="mt-1.5 font-display text-[1.9rem] font-semibold tracking-tightest text-gray-900">{data.counts.pendingTasks}</div>
        </Link>
        <Link to="/tarefas" className="group surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-elevated">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Tarefas atrasadas</div>
          <div className="mt-1 font-display text-[1.9rem] font-semibold tracking-tightest text-danger-600">{data.counts.overdueTasks}</div>
        </Link>
        <Link to="/intimacoes" className="group surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-elevated">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Intimações pendentes</div>
          <div className="mt-1 font-display text-[1.9rem] font-semibold tracking-tightest text-warning-600">{data.counts.pendingPublications}</div>
        </Link>
        {finance.receivableCount > 0 && (
          <Link to="/financeiro" className="group surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-elevated">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">A receber</div>
            <div className="mt-1.5 font-display text-[1.9rem] font-semibold tracking-tightest text-gray-900">{formatBRL(finance.receivableTotal)}</div>
          </Link>
        )}
        {finance.receivedTotal > 0 && (
          <Link to="/financeiro" className="group surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-elevated">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Recebido</div>
            <div className="mt-1 font-display text-[1.9rem] font-semibold tracking-tightest text-success-600">{formatBRL(finance.receivedTotal)}</div>
          </Link>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Tarefas do dia">
          {data.todayTasks.length === 0 ? (
            <EmptyState title="Nenhuma tarefa para hoje." />
          ) : (
            <ul className="space-y-2">
              {data.todayTasks.map((t) => (
                <li key={String(t.id)} className="flex items-center justify-between rounded-lg border border-gray-200 px-3.5 py-3 transition-colors hover:bg-gray-50">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{String(t.title)}</div>
                    <div className="text-xs text-gray-500">{String(t.process_title ?? '')}</div>
                  </div>
                  <Badge color={statusColor(String(t.priority))}>{statusLabel(String(t.priority))}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Próximas tarefas">
          {data.upcomingTasks.length === 0 ? (
            <EmptyState title="Nenhuma tarefa futura." />
          ) : (
            <ul className="space-y-2">
              {data.upcomingTasks.map((t) => (
                <li key={String(t.id)} className="flex items-center justify-between rounded-lg border border-gray-200 px-3.5 py-3 transition-colors hover:bg-gray-50">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{String(t.title)}</div>
                    <div className="text-xs text-gray-500">{String(t.process_title ?? '')}</div>
                  </div>
                  <div className="text-xs text-gray-400">{formatDateTime(String(t.due_date ?? ''))}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Atividades recentes">
          {data.recentActivities.length === 0 ? (
            <EmptyState title="Sem atividades recentes." />
          ) : (
            <ul className="space-y-2">
              {data.recentActivities.map((a) => (
                <li key={String(a.id)} className="flex items-center justify-between rounded-lg border border-gray-200 px-3.5 py-3 transition-colors hover:bg-gray-50">
                  <div className="text-sm">
                    <span className="font-medium">{String(a.title)}</span>
                    {Boolean(a.process_title) && <span className="text-gray-500"> · {String(a.process_title)}</span>}
                  </div>
                  <div className="text-xs text-gray-400">{formatDateTime(String(a.created_at))}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}