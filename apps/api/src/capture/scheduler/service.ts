import { getPool } from '../../db/client';
import { getEnv } from '../../config';
import { syncCase } from '../sync/service';
import type { SyncStatus } from '../sync/service';

/**
 * ETAPA 9 — Monitoramento automático de processos.
 *
 * Este módulo ORQUESTRA chamadas ao syncCase() existente. Ele NÃO consulta o
 * DataJud diretamente, NÃO normaliza movimentações, NÃO insere eventos e NÃO
 * envia e-mail — toda a lógica de negócio continua no syncCase().
 *
 * Responsabilidades:
 *  - selecionar Cases elegíveis (monitoring_status = ACTIVE, CNJ válido, no
 *    intervalo de sincronização, da instalação atual);
 *  - respeitar limite de concorrência configurável;
 *  - proteger contra execução simultânea do mesmo Case (lock no banco);
 *  - chamar syncCase();
 *  - produzir logs sanitizados (sem secrets).
 *
 * Não usa Redis/BullMQ/filas. Funciona em VPS comum dentro do processo da API.
 */

export interface SchedulerCase {
  id: string;
  organizationId: string;
  processNumber: string | null;
  monitoringStatus: string;
  lastSyncedAt: string | null;
}

export interface SchedulerCounters {
  eligible: number;
  started: number;
  success: number;
  partial: number;
  failed: number;
  skipped: number;
  newEvents: number;
  errors: number;
}

export interface SchedulerCycleResult extends SchedulerCounters {
  cycleId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface MonitorScheduler {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  lastResult(): SchedulerCycleResult | null;
  runOnce(): Promise<SchedulerCycleResult>;
}

/**
 * Scheduler baseado em setInterval. Em produção roda dentro do processo da API
 * (uma instância por VPS/instalação). A proteção contra duplicação entre
 * execuções concorrentes é feita via lock no PostgreSQL (pg_try_advisory_lock).
 */
export function createMonitorScheduler(
  opts: { enabled?: boolean; intervalMinutes?: number; concurrency?: number; syncFn?: typeof syncCase } = {},
): MonitorScheduler {
  const pool = getPool();
  const doSync = opts.syncFn ?? syncCase;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;
  let lastResult: SchedulerCycleResult | null = null;

  // Sinaliza o case como em processamento no banco (lock otimista).
  // Evita que dois schedulers processem o mesmo case ao mesmo tempo.
  async function tryAcquireCaseLock(caseId: string): Promise<boolean> {
    try {
      const res = await pool.query(
        `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`,
        [`monitor:${caseId}`],
      );
      return res.rows[0]?.locked === true;
    } catch {
      return false;
    }
  }

  async function releaseCaseLock(caseId: string): Promise<void> {
    try {
      await pool.query(
        `SELECT pg_advisory_unlock(hashtextextended($1, 0))`,
        [`monitor:${caseId}`],
      );
    } catch {
      // lock expira com a sessão; liberação é best-effort
    }
  }

  /** Seleciona Cases elegíveis da instalação atual (organization é única por instalação). */
  async function selectEligibleCases(limit = 50): Promise<SchedulerCase[]> {
    const intervalMinutes = opts.intervalMinutes ?? getEnv().PROCESS_MONITOR_INTERVAL_MINUTES;
    const res = await pool.query(
      `SELECT id, organization_id AS "organizationId", process_number AS "processNumber",
              monitoring_status AS "monitoringStatus", last_synced_at AS "lastSyncedAt"
       FROM cases
       WHERE monitoring_status = 'ACTIVE'
         AND process_number IS NOT NULL
         AND process_number <> ''
         AND (
           last_synced_at IS NULL
           OR last_synced_at <= now() - ($1 || ' minutes')::interval
         )
       ORDER BY COALESCE(last_synced_at, 'epoch') ASC
       LIMIT $2`,
      [intervalMinutes, limit],
    );
    return res.rows as SchedulerCase[];
  }

  async function runOnce(): Promise<SchedulerCycleResult> {
    const cycleId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();
    const counters: SchedulerCounters = { eligible: 0, started: 0, success: 0, partial: 0, failed: 0, skipped: 0, newEvents: 0, errors: 0 };

    try {
      const eligible = await selectEligibleCases();
      counters.eligible = eligible.length;
      console.log(`[monitor] ciclo ${cycleId} iniciado — ${eligible.length} processos elegíveis`);

      const concurrency = opts.concurrency ?? getEnv().PROCESS_MONITOR_CONCURRENCY;
      const workerCount = Math.max(1, Math.min(concurrency, Math.max(1, eligible.length)));
      let idx = 0;

      const worker = async () => {
        while (idx < eligible.length) {
          const item = eligible[idx++];
          if (!item) break;

          counters.started += 1;
          // Lock do banco: evita que o mesmo case seja processado por outro scheduler/sessão.
          const locked = await tryAcquireCaseLock(item.id);
          if (!locked) {
            counters.skipped += 1;
            console.log(`[monitor] skip case=${item.id} (em processamento)`);
            continue;
          }

          try {
            console.log(`[monitor] sync iniciado case=${item.id}`);
            const result = await doSync(item.organizationId, item.id, null, undefined);
            if (result.status === 'SUCCESS') counters.success += 1;
            else if (result.status === 'PARTIAL') counters.partial += 1;
            else counters.failed += 1;
            counters.newEvents += result.inserted;
            if (result.status === 'FAILED') counters.errors += 1;
            console.log(`[monitor] sync concluído case=${item.id} status=${result.status} novos=${result.inserted}`);
          } catch (e) {
            counters.failed += 1;
            counters.errors += 1;
            const msg = e instanceof Error ? e.message : 'Erro desconhecido.';
            console.log(`[monitor] sync falhou case=${item.id} error=${msg.slice(0, 200)}`);
          } finally {
            await releaseCaseLock(item.id);
          }
        }
      };

      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      const finishedAt = new Date().toISOString();
      const result: SchedulerCycleResult = {
        cycleId,
        startedAt,
        finishedAt,
        durationMs: Date.now() - new Date(startedAt).getTime(),
        ...counters,
      };
      lastResult = result;
      console.log(`[monitor] ciclo ${cycleId} concluído duration=${result.durationMs}ms success=${counters.success} partial=${counters.partial} failed=${counters.failed} novos=${counters.newEvents}`);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido.';
      console.log(`[monitor] ciclo ${cycleId} falhou — ${msg.slice(0, 200)}`);
      const finishedAt = new Date().toISOString();
      const result: SchedulerCycleResult = { cycleId, startedAt, finishedAt, durationMs: Date.now() - new Date(startedAt).getTime(), ...counters, errors: counters.errors + 1 };
      lastResult = result;
      return result;
    }
  }

  function start(): void {
    if (timer || running || stopped) return;
    const enabled = opts.enabled ?? getEnv().PROCESS_MONITOR_ENABLED === 'true';
    if (!enabled) {
      console.log('[monitor] desabilitado via PROCESS_MONITOR_ENABLED');
      return;
    }
    const intervalMs = (opts.intervalMinutes ?? getEnv().PROCESS_MONITOR_INTERVAL_MINUTES) * 60 * 1000;
    // Aguarda o primeiro intervalo para não disparar sincronizações em lote no boot.
    timer = setInterval(() => {
      if (running) return;
      running = true;
      void runOnce().finally(() => { running = false; });
    }, intervalMs);
    timer.unref?.();
    console.log(`[monitor] agendado a cada ${intervalMs / 60000} min`);
  }

  function stop(): void {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    console.log('[monitor] scheduler parado');
  }

  return {
    start,
    stop,
    isRunning: () => running,
    lastResult: () => lastResult,
    runOnce,
  };
}

/** Instância global única (evita múltiplos schedulers em hot reload). */
let scheduler: MonitorScheduler | null = null;

export function getMonitorScheduler(): MonitorScheduler {
  if (!scheduler) {
    scheduler = createMonitorScheduler();
  }
  return scheduler;
}

export function stopMonitorScheduler(): void {
  if (scheduler) {
    scheduler.stop();
    scheduler = null;
  }
}

/** Tipos reutilizados para testes. */
export type { SyncStatus };
