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

  useEffect(() => {
    apiGet<DashboardData>('/api/dashboard')
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="text-red-600">{error}</div>;
  if (!data) return <div className="text-gray-500">Carregando…</div>;

  const hasData = data.counts.activeCases + data.counts.pendingTasks + data.counts.pendingPublications > 0;

  const finance = data.finance ?? { receivableTotal: 0, receivableCount: 0, receivedTotal: 0 };
  const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (!hasData && finance.receivableCount === 0) {
    return (
      <div>
        <h1 className="mb-6 text-xl font-semibold">Visão Geral</h1>
        <EmptyState title="Nenhum processo cadastrado." hint="Comece criando seu primeiro cliente e processo." />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Visão Geral</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/processos" className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm hover:border-brand-300">
          <div className="text-sm text-gray-500">Processos ativos</div>
          <div className="mt-1 text-3xl font-bold">{data.counts.activeCases}</div>
        </Link>
        <Link to="/tarefas" className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm hover:border-brand-300">
          <div className="text-sm text-gray-500">Tarefas pendentes</div>
          <div className="mt-1 text-3xl font-bold">{data.counts.pendingTasks}</div>
        </Link>
        <Link to="/tarefas" className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm hover:border-brand-300">
          <div className="text-sm text-gray-500">Tarefas atrasadas</div>
          <div className="mt-1 text-3xl font-bold text-red-600">{data.counts.overdueTasks}</div>
        </Link>
        <Link to="/intimacoes" className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm hover:border-brand-300">
          <div className="text-sm text-gray-500">Intimações pendentes</div>
          <div className="mt-1 text-3xl font-bold text-yellow-600">{data.counts.pendingPublications}</div>
        </Link>
        {finance.receivableCount > 0 && (
          <Link to="/financeiro" className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm hover:border-brand-300">
            <div className="text-sm text-gray-500">A receber</div>
            <div className="mt-1 text-3xl font-bold">{formatBRL(finance.receivableTotal)}</div>
          </Link>
        )}
        {finance.receivedTotal > 0 && (
          <Link to="/financeiro" className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm hover:border-brand-300">
            <div className="text-sm text-gray-500">Recebido</div>
            <div className="mt-1 text-3xl font-bold text-green-600">{formatBRL(finance.receivedTotal)}</div>
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
                <li key={String(t.id)} className="flex items-center justify-between rounded border border-gray-100 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{String(t.title)}</div>
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
                <li key={String(t.id)} className="flex items-center justify-between rounded border border-gray-100 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{String(t.title)}</div>
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
                <li key={String(a.id)} className="flex items-center justify-between rounded border border-gray-100 px-3 py-2">
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