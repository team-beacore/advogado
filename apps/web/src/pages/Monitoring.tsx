import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../api/client';
import { Card, ErrorAlert, Badge } from '../components/ui';

interface SchedulerCounters {
  eligible: number; started: number; success: number; partial: number;
  failed: number; skipped: number; newEvents: number; errors: number;
}

interface SchedulerStatusData {
  enabled: boolean; running: boolean; startedAt: string | null;
  intervalMinutes: number; concurrency: number; staleAfterMinutes: number;
  lastCycleAt: string | null; lastCycleDurationMs: number | null;
  lastCycleStats: SchedulerCounters | null; nextCycleAt: string | null;
  cumulative: SchedulerCounters & { cycles: number };
}

interface OrgStats {
  active: number; paused: number; error: number; stale: number;
  totalSyncs: number; totalEvents: number;
}

interface StatusResponse {
  scheduler: SchedulerStatusData;
  staleAfterMinutes: number;
  organization: OrgStats;
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}

function duration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function Monitoring() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      setLoading(true);
      const res = await apiGet<StatusResponse>('/api/monitoring/status');
      setData(res);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="text-sm text-gray-500">Carregando…</div>;

  const s = data?.scheduler;
  const org = data?.organization;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-lg font-semibold text-gray-900">Monitoramento</h1>
        <p className="mt-1 text-sm text-gray-500">Estado operacional do monitoramento automático de processos.</p>
      </div>

      <ErrorAlert error={error} />

      {!data && !error && <div className="text-sm text-gray-500">Nenhum dado disponível.</div>}

      {data && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Scheduler */}
          <Card title="Scheduler">
            <dl className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-gray-500">Status</dt>
                <dd>
                  {s?.enabled ? (
                    s?.running
                      ? <Badge color="green">Operacional</Badge>
                      : <Badge color="yellow">Aguardando ciclo</Badge>
                  ) : (
                    <Badge color="gray">Desabilitado</Badge>
                  )}
                </dd>
              </div>
              {s?.enabled && (
                <>
                  <div className="flex justify-between"><dt className="text-gray-500">Iniciado em</dt><dd className="font-medium text-gray-900">{fmt(s?.startedAt)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Intervalo</dt><dd className="font-medium text-gray-900">{s?.intervalMinutes} min</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Concorrência</dt><dd className="font-medium text-gray-900">{s?.concurrency}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Último ciclo</dt><dd className="font-medium text-gray-900">{fmt(s?.lastCycleAt)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Duração</dt><dd className="font-medium text-gray-900">{duration(s?.lastCycleDurationMs)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Próximo ciclo</dt><dd className="font-medium text-gray-900">{fmt(s?.nextCycleAt)}</dd></div>
                  {s?.lastCycleStats && (
                    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Últimos dados</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <span>Verificados: <b>{s.lastCycleStats.eligible}</b></span>
                        <span>Sucesso: <b>{s.lastCycleStats.success}</b></span>
                        <span>Parcial: <b>{s.lastCycleStats.partial}</b></span>
                        <span>Falhas: <b>{s.lastCycleStats.failed}</b></span>
                        <span>Pulados: <b>{s.lastCycleStats.skipped}</b></span>
                        <span>Novos eventos: <b>{s.lastCycleStats.newEvents}</b></span>
                      </div>
                    </div>
                  )}
                  {s?.cumulative.cycles > 0 && (
                    <div className="mt-1 rounded-lg border border-gray-200 p-3">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Acumulado (desde o início)</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <span>Ciclos: <b>{s.cumulative.cycles}</b></span>
                        <span>Verificados: <b>{s.cumulative.eligible}</b></span>
                        <span>Sucesso: <b>{s.cumulative.success}</b></span>
                        <span>Falhas: <b>{s.cumulative.failed}</b></span>
                        <span>Novos eventos: <b>{s.cumulative.newEvents}</b></span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </dl>
          </Card>

          {/* Organização */}
          <Card title="Processos">
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between"><dt className="text-gray-500">Monitoramento ativo</dt><dd className="font-medium text-gray-900">{org?.active ?? 0}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Monitoramento pausado</dt><dd className="font-medium text-gray-900">{org?.paused ?? 0}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Com erro</dt><dd className="font-medium text-gray-900">{org?.error ?? 0}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Sincronização atrasada</dt><dd className="font-medium text-gray-900">{org?.stale ?? 0}</dd></div>
              <div className="mt-2 border-t border-gray-100 pt-2" />
              <div className="flex justify-between"><dt className="text-gray-500">Total de sincronizações</dt><dd className="font-medium text-gray-900">{org?.totalSyncs ?? 0}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Eventos importados</dt><dd className="font-medium text-gray-900">{org?.totalEvents ?? 0}</dd></div>
            </dl>
            {data?.staleAfterMinutes && (
              <p className="mt-3 text-xs text-gray-400">
                Sincronização atrasada: mais de {data.staleAfterMinutes} min sem atualização.
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}