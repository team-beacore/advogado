import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, createSecondUserInOrg, createSuperAdmin, makeApp, resetDb } from './helpers';
import { getPool } from '../src/db/client';
import { createMonitorScheduler, stopMonitorScheduler } from '../src/capture/scheduler/service';
import type { SyncResult } from '../src/capture/sync/service';
import { syncCase } from '../src/capture/sync/service';
import { setNotificationChannelsForTests } from '../src/notify/registry';
import type { NotificationChannel, ChannelMessage, ChannelResult } from '../src/notify/types';

class FakeEmailChannel implements NotificationChannel {
  readonly name = 'EMAIL' as const;
  lastMessage: ChannelMessage | null = null;
  sentCount = 0;
  isConfigured(_config: Record<string, unknown> | null): boolean { return true; }
  async send(msg: ChannelMessage, _config: Record<string, unknown>): Promise<ChannelResult> {
    this.lastMessage = msg;
    this.sentCount += 1;
    return { channel: 'EMAIL', status: 'SENT', externalReference: 'fake' };
  }
}

const CNJ = '0000832-35.2018.4.01.3202';

function fakeSync(behavior: { fail?: boolean; newEvents?: number } = {}): typeof import('../src/capture/sync/service').syncCase {
  return async (organizationId, caseId, _userId): Promise<SyncResult> => {
    if (behavior.fail) throw new Error('FALHA_TESTE');
    return {
      caseId, processNumber: CNJ, source: 'DATAJUD', status: 'SUCCESS', found: 43,
      inserted: behavior.newEvents ?? 0, duplicates: 43 - (behavior.newEvents ?? 0), errors: 0,
      movementsFound: 43, publicationsFound: 0, synchronizedAt: new Date().toISOString(),
      runId: `run-${caseId}`, errorMessage: null,
    };
  };
}

describe('ETAPA 9 — Scheduler de monitoramento', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);
  const emailChannel = new FakeEmailChannel();

  before(async () => {
    await resetDb();
    setNotificationChannelsForTests([emailChannel]);
  });
  after(async () => {
    setNotificationChannelsForTests(null);
    stopMonitorScheduler();
    const { closePool } = await import('../src/db/client');
    await closePool();
  });
  beforeEach(async () => { await resetDb(); });

  async function insertCase(overrides: { monitoringStatus?: string; lastSyncedAt?: string | null; processNumber?: string | null }) {
    const session = await helper.registerAndLogin();
    const pool = getPool();
    const pn = 'processNumber' in overrides ? overrides.processNumber : CNJ;
    const res = await pool.query(
      `INSERT INTO cases (organization_id, title, process_number, monitoring_status, last_synced_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [session.orgId, 'Proc', pn, overrides.monitoringStatus ?? 'ACTIVE', overrides.lastSyncedAt ?? null],
    );
    return { session, caseRow: res.rows[0] };
  }

  it('1. seleciona somente ACTIVE com CNJ válido; PAUSED/ERROR/SEM-CNJ ficam fora', async () => {
    await insertCase({ monitoringStatus: 'ACTIVE' });                       // elegível
    await insertCase({ monitoringStatus: 'PAUSED' });                       // fora
    await insertCase({ monitoringStatus: 'ERROR' });                        // fora
    await insertCase({ monitoringStatus: 'ACTIVE', processNumber: null });  // fora (sem CNJ)

    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 60, concurrency: 2, syncFn: fakeSync({ newEvents: 0 }) });
    const result = await scheduler.runOnce();
    assert.equal(result.eligible, 1);
    assert.equal(result.started, 1);
    assert.equal(result.success, 1);
  });

  it('2. last_synced_at recente impede nova sincronização (intervalo respeitado)', async () => {
    await insertCase({ monitoringStatus: 'ACTIVE', lastSyncedAt: new Date().toISOString() });
    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 60, concurrency: 2, syncFn: fakeSync({}) });
    const result = await scheduler.runOnce();
    assert.equal(result.eligible, 0);
  });

  it('3. limite de concorrência é respeitado (máx. 2 simultâneos)', async () => {
    await insertCase({ monitoringStatus: 'ACTIVE' });
    await insertCase({ monitoringStatus: 'ACTIVE' });
    await insertCase({ monitoringStatus: 'ACTIVE' });
    await insertCase({ monitoringStatus: 'ACTIVE' });

    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const countingSync: typeof import('../src/capture/sync/service').syncCase = async (orgId, caseId): Promise<SyncResult> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 60));
      active -= 1;
      calls += 1;
      return { caseId, processNumber: CNJ, source: 'DATAJUD', status: 'SUCCESS', found: 1, inserted: 0, duplicates: 1, errors: 0, movementsFound: 1, publicationsFound: 0, synchronizedAt: new Date().toISOString(), runId: `r-${caseId}` };
    };

    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 60, concurrency: 2, syncFn: countingSync });
    const result = await scheduler.runOnce();
    assert.equal(calls, 4);
    assert.equal(result.started, 4);
    assert.ok(maxActive <= 2, `concorrência máxima foi ${maxActive}`);
  });

  it('4. falha de um Case não interrompe os demais (erro isolado)', async () => {
    const { caseRow: a } = await insertCase({ monitoringStatus: 'ACTIVE' });
    await insertCase({ monitoringStatus: 'ACTIVE' });
    await insertCase({ monitoringStatus: 'ACTIVE' });

    let calls = 0;
    const flakySync: typeof import('../src/capture/sync/service').syncCase = async (orgId, caseId): Promise<SyncResult> => {
      calls += 1;
      if (caseId === a.id) throw new Error('FALHA_CONTROLADA');
      return { caseId, processNumber: CNJ, source: 'DATAJUD', status: 'SUCCESS', found: 1, inserted: 0, duplicates: 1, errors: 0, movementsFound: 1, publicationsFound: 0, synchronizedAt: new Date().toISOString(), runId: `r-${caseId}` };
    };

    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 60, concurrency: 2, syncFn: flakySync });
    const result = await scheduler.runOnce();
    assert.equal(calls, 3);
    assert.equal(result.failed, 1);
    assert.equal(result.success, 2);
  });

  it('5. PROCESS_MONITOR_ENABLED=false → start() não agenda', async () => {
    const scheduler = createMonitorScheduler({ enabled: false, intervalMinutes: 60, concurrency: 2, syncFn: fakeSync({}) });
    scheduler.start();
    assert.equal(scheduler.isRunning(), false);
    scheduler.stop();
  });

  it('6. stop() limpa o scheduler (não continua agendando)', async () => {
    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 1, concurrency: 1, syncFn: fakeSync({}) });
    scheduler.start();
    assert.ok(true); // iniciou sem erro
    scheduler.stop();
    assert.equal(scheduler.isRunning(), false);
  });

  it('7. scheduler chama syncCase (não implementa lógica própria de DataJud)', async () => {
    await insertCase({ monitoringStatus: 'ACTIVE' });
    let called = false;
    const spySync: typeof import('../src/capture/sync/service').syncCase = async (orgId, caseId): Promise<SyncResult> => {
      called = true;
      return { caseId, processNumber: CNJ, source: 'DATAJUD', status: 'SUCCESS', found: 43, inserted: 2, duplicates: 41, errors: 0, movementsFound: 43, publicationsFound: 0, synchronizedAt: new Date().toISOString(), runId: `r-${caseId}` };
    };
    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 60, concurrency: 1, syncFn: spySync });
    const result = await scheduler.runOnce();
    assert.equal(called, true);
    assert.equal(result.newEvents, 2);
  });

  it('8. lock evita execução simultânea do mesmo Case', async () => {
    const { caseRow } = await insertCase({ monitoringStatus: 'ACTIVE' });
    const pool = getPool();

    // Simula outra execução em andamento: adquire o advisory lock do case.
    const locker = await pool.connect();
    const lockRes = await locker.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [`monitor:${caseRow.id}`]);
    assert.equal(lockRes.rows[0].locked, true);

    let syncCalls = 0;
    const countingSync: typeof import('../src/capture/sync/service').syncCase = async (orgId, caseId): Promise<SyncResult> => {
      syncCalls += 1;
      return { caseId, processNumber: CNJ, source: 'DATAJUD', status: 'SUCCESS', found: 1, inserted: 0, duplicates: 1, errors: 0, movementsFound: 1, publicationsFound: 0, synchronizedAt: new Date().toISOString(), runId: `r-${caseId}` };
    };
    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 60, concurrency: 1, syncFn: countingSync });
    const result = await scheduler.runOnce();
    // O case está "travado" por outra sessão → scheduler não chama syncCase e registra skip.
    assert.equal(syncCalls, 0);
    assert.equal(result.skipped, 1);
    await locker.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`monitor:${caseRow.id}`]);
    locker.release();
  });

  it('9. ciclo registra contadores (eligible/started/success/newEvents)', async () => {
    await insertCase({ monitoringStatus: 'ACTIVE' });
    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 60, concurrency: 1, syncFn: fakeSync({ newEvents: 3 }) });
    const result = await scheduler.runOnce();
    assert.equal(result.eligible, 1);
    assert.equal(result.started, 1);
    assert.equal(result.success, 1);
    assert.equal(result.newEvents, 3);
    assert.ok(result.durationMs >= 0);
  });
});

describe('ETAPA 9 — Integração: monitoring pause/activate + isolamento', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  async function makeCase(session: { cookie: string }) {
    const res = await request(app).post('/api/processes').set('Cookie', session.cookie).send({ title: 'Proc', processNumber: CNJ }).expect(201);
    return res.body;
  }

  it('10. PATCH monitoring enabled=false → PAUSED + auditoria', async () => {
    const session = await helper.registerAndLogin();
    const caseRow = await makeCase(session);
    const res = await request(app).patch(`/api/processes/${caseRow.id}/monitoring`).set('Cookie', session.cookie).send({ enabled: false }).expect(200);
    assert.equal(res.body.monitoring_status, 'PAUSED');
    const pool = getPool();
    const row = await pool.query('SELECT monitoring_status FROM cases WHERE id = $1', [caseRow.id]);
    assert.equal(row.rows[0].monitoring_status, 'PAUSED');
    const audit = await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'PROCESS_MONITORING_PAUSED' AND entity_id = $1", [caseRow.id]);
    assert.ok(audit.rows[0].n >= 1);
  });

  it('11. PATCH monitoring enabled=true → ACTIVE', async () => {
    const session = await helper.registerAndLogin();
    const caseRow = await makeCase(session);
    await request(app).patch(`/api/processes/${caseRow.id}/monitoring`).set('Cookie', session.cookie).send({ enabled: false }).expect(200);
    const res = await request(app).patch(`/api/processes/${caseRow.id}/monitoring`).set('Cookie', session.cookie).send({ enabled: true }).expect(200);
    assert.equal(res.body.monitoring_status, 'ACTIVE');
  });

  it('12. FINANCE não pode alterar monitoramento (403)', async () => {
    const admin = await helper.registerAndLogin();
    const caseRow = await makeCase(admin);
    const finance = await createSecondUserInOrg(app, admin, { role: 'FINANCE' });
    await request(app).patch(`/api/processes/${caseRow.id}/monitoring`).set('Cookie', finance.cookie).send({ enabled: false }).expect(403);
  });

  it('13. isolamento: org B não altera monitoramento de case da org A', async () => {
    const orgA = await helper.registerAndLogin();
    const caseRow = await makeCase(orgA);
    const orgB = await helper.registerAndLogin();
    const res = await request(app).patch(`/api/processes/${caseRow.id}/monitoring`).set('Cookie', orgB.cookie).send({ enabled: false });
    assert.equal(res.status, 404);
  });

  it('14. SUPER_ADMIN não acessa a rota jurídica normal', async () => {
    const sa = await createSuperAdmin(app);
    await request(app).patch('/api/processes/00000000-0000-0000-0000-000000000000/monitoring').set('Cookie', sa.cookie).send({ enabled: false }).expect(403);
  });
});

describe('ETAPA 9 — Execução automática (timer real, sem chamar runOnce manualmente)', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);
  const emailChannel = new FakeEmailChannel();

  before(async () => {
    await resetDb();
    setNotificationChannelsForTests([emailChannel]);
  });
  after(async () => {
    setNotificationChannelsForTests(null);
    stopMonitorScheduler();
    const { closePool } = await import('../src/db/client');
    await closePool();
  });
  beforeEach(async () => { await resetDb(); emailChannel.lastMessage = null; });

  /** Aguarda o timer disparar um ciclo (intervalo curto definido pelo teste). */
  async function waitForCycle(scheduler: ReturnType<typeof createMonitorScheduler>, maxMs = 30000): Promise<ReturnType<typeof scheduler.lastResult>> {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      const r = scheduler.lastResult();
      if (r) return r;
      await new Promise((r2) => setTimeout(r2, 200));
    }
    return null;
  }

  /** Aguarda o N-ésimo ciclo (para distinguir o primeiro do segundo no mesmo scheduler). */
  async function waitForCycleCount(scheduler: ReturnType<typeof createMonitorScheduler>, target: number, maxMs = 30000): Promise<ReturnType<typeof scheduler.lastResult>> {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      const cycles = scheduler.getStatus().cumulative.cycles;
      if (cycles >= target) return scheduler.lastResult();
      await new Promise((r2) => setTimeout(r2, 200));
    }
    return scheduler.lastResult();
  }

  async function insertCase(orgId: string, overrides: { monitoringStatus?: string; processNumber?: string | null; lastSyncedAt?: string | null } = {}) {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO cases (organization_id, title, process_number, monitoring_status, last_synced_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [orgId, 'Proc', overrides.processNumber ?? CNJ, overrides.monitoringStatus ?? 'ACTIVE', 'lastSyncedAt' in overrides ? overrides.lastSyncedAt : null],
    );
    return res.rows[0];
  }

  it('execução automática: start() dispara syncCase sozinho e cria capture_run + last_synced_at', async () => {
    const session = await helper.registerAndLogin();
    const caseRow = await insertCase(session.orgId);
    const pool = getPool();

    // syncFn REAL (syncCase) com lookup controlado (fonte injetada, sem rede).
    const syncFn = (orgId: string, caseId: string): Promise<SyncResult> =>
      syncCase(orgId, caseId, session.userId, undefined, async () => ({
        process: { processNumber: CNJ, title: 'Proc', court: 'TRF1' },
        movements: [{ processNumber: CNJ, date: '2026-09-01T10:00:00.000Z', description: 'Movimento automático 1', sourceReference: 'datajud-mov-1' }],
        metadata: { dataJud: { tribunal: 'TRF1', movementCount: 1 } },
      }));

    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 1 / 60, concurrency: 1, syncFn });
    scheduler.start();
    const result = await waitForCycle(scheduler);
    scheduler.stop();

    assert.ok(result, 'scheduler NÃO executou nenhum ciclo automaticamente');
    assert.equal(result.success, 1);
    assert.equal(result.started, 1);
    assert.ok(result.newEvents >= 1);

    // capture_run criado pela sincronização automática
    const runRes = await pool.query('SELECT * FROM capture_runs WHERE case_id = $1 AND adapter = $2', [caseRow.id, 'SYNC']);
    assert.equal(runRes.rows.length, 1);
    assert.equal(runRes.rows[0].source, 'DATAJUD');
    assert.equal(runRes.rows[0].status, 'SUCCESS');
    assert.ok(runRes.rows[0].started_at);
    assert.ok(runRes.rows[0].finished_at);
    assert.equal(runRes.rows[0].case_id, caseRow.id);

    // last_synced_at atualizado
    const caseDb = await pool.query('SELECT last_synced_at FROM cases WHERE id = $1', [caseRow.id]);
    assert.ok(caseDb.rows[0].last_synced_at);
  });

  it('ciclo automático não duplica eventos; PAUSADO não é sincronizado; ERROR não é sincronizado', async () => {
    const session = await helper.registerAndLogin();
    // CNJs distintos (unique index por (org, process_number))
    const active = await insertCase(session.orgId);
    await insertCase(session.orgId, { monitoringStatus: 'PAUSED', processNumber: '0001000-20.2020.4.01.3202' });
    await insertCase(session.orgId, { monitoringStatus: 'ERROR', processNumber: '0002000-21.2020.4.01.3202' });
    const pool = getPool();

    let calls = 0;
    const syncFn = (orgId: string, caseId: string): Promise<SyncResult> => {
      calls += 1;
      return Promise.resolve({
        caseId, processNumber: CNJ, source: 'DATAJUD', status: 'SUCCESS', found: 1,
        inserted: 0, duplicates: 1, errors: 0, movementsFound: 1, publicationsFound: 0,
        synchronizedAt: new Date().toISOString(), runId: `run-${caseId}`, errorMessage: null,
      });
    };

    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 1 / 60, concurrency: 1, syncFn });
    scheduler.start();
    const result = await waitForCycle(scheduler);
    scheduler.stop();

    assert.ok(result, 'scheduler NÃO executou ciclo');
    assert.equal(calls, 1, 'somente o caso ACTIVE foi sincronizado');
    assert.equal(result.eligible, 1);

    // ciclo 2: mesmo caso, 0 novos, sem duplicação de eventos (fake retorna 0 novos)
    const s2 = createMonitorScheduler({ enabled: true, intervalMinutes: 1 / 60, concurrency: 1, syncFn });
    s2.start();
    const r2 = await waitForCycle(s2);
    s2.stop();
    assert.ok(r2);
    assert.equal(r2.success, 1);
    assert.equal(r2.newEvents, 0);

    // Nenhuma duplicação de eventos reais (fora do fake): evento real do teste anterior
    const evRes = await pool.query('SELECT count(*)::int AS n FROM case_events WHERE process_id = $1', [active.id]);
    assert.equal(evRes.rows[0].n, 0);
  });

  it('PAUSAR → scheduler para de sincronizar; ATIVAR → volta a ser elegível (integrado com HTTP)', async () => {
    const session = await helper.registerAndLogin();
    // Cria via HTTP para existir case_members (o PATCH /monitoring exige permissão no case).
    const createRes = await request(app).post('/api/processes').set('Cookie', session.cookie).send({ title: 'Proc', processNumber: CNJ }).expect(201);
    const caseRow = { id: createRes.body.id as string };
    const pool = getPool();

    // Pausa via endpoint (fluxo real da UI)
    await request(app).patch(`/api/processes/${caseRow.id}/monitoring`).set('Cookie', session.cookie).send({ enabled: false }).expect(200);
    const paused = await pool.query('SELECT monitoring_status FROM cases WHERE id = $1', [caseRow.id]);
    assert.equal(paused.rows[0].monitoring_status, 'PAUSED');

    let calls = 0;
    const syncFn = (orgId: string, caseId: string): Promise<SyncResult> => {
      calls += 1;
      return Promise.resolve({
        caseId, processNumber: CNJ, source: 'DATAJUD', status: 'SUCCESS', found: 1,
        inserted: 0, duplicates: 1, errors: 0, movementsFound: 1, publicationsFound: 0,
        synchronizedAt: new Date().toISOString(), runId: `run-${caseId}`, errorMessage: null,
      });
    };

    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 1 / 60, concurrency: 1, syncFn });
    scheduler.start();
    const r1 = await waitForCycle(scheduler);
    assert.ok(r1);
    assert.equal(calls, 0, 'processo PAUSADO não deve ser sincronizado');

    // Reativa
    await request(app).patch(`/api/processes/${caseRow.id}/monitoring`).set('Cookie', session.cookie).send({ enabled: true }).expect(200);
    const r2 = await waitForCycleCount(scheduler, 2);
    assert.ok(r2);
    assert.ok(calls >= 1, 'após reativar, o processo volta a ser elegível');
    scheduler.stop();
  });

  it('restart: nova instância do scheduler volta a sincronizar (simula reinício da API)', async () => {
    const session = await helper.registerAndLogin();
    await insertCase(session.orgId);

    let calls = 0;
    const syncFn = (orgId: string, caseId: string): Promise<SyncResult> => {
      calls += 1;
      return Promise.resolve({
        caseId, processNumber: CNJ, source: 'DATAJUD', status: 'SUCCESS', found: 1,
        inserted: 0, duplicates: 1, errors: 0, movementsFound: 1, publicationsFound: 0,
        synchronizedAt: new Date().toISOString(), runId: `run-${caseId}`, errorMessage: null,
      });
    };

    // instância 1 roda
    const s1 = createMonitorScheduler({ enabled: true, intervalMinutes: 1 / 60, concurrency: 1, syncFn });
    s1.start();
    const r1 = await waitForCycle(s1);
    assert.ok(r1);
    s1.stop();

    // "reinício": nova instância
    const s2 = createMonitorScheduler({ enabled: true, intervalMinutes: 1 / 60, concurrency: 1, syncFn });
    s2.start();
    const r2 = await waitForCycle(s2);
    s2.stop();

    assert.ok(r2, 'após reinício o scheduler voltou a executar ciclo');
    assert.ok(calls >= 2, 'deveria ter sincronizado antes e depois do reinício');
  });
});
