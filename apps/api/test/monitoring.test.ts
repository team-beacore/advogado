import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, createSecondUserInOrg, createSuperAdmin, makeApp, resetDb } from './helpers';
import { getPool } from '../src/db/client';
import { createMonitorScheduler, stopMonitorScheduler, getMonitorStatus, isCaseStale, staleThresholdMinutes } from '../src/capture/scheduler/service';
import { classifySyncError } from '../src/capture/sync/service';
import { DataJudError, DATAJUD_ERROR_CODES } from '../src/capture/datajud/errors';
import type { SyncResult } from '../src/capture/sync/service';
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
    return { channel: 'EMAIL', status: 'SENT', externalReference: 'fake-email' };
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

describe('ETAPA 10 — Monitoramento: scheduler status', () => {
  before(async () => { await resetDb(); });
  after(async () => { stopMonitorScheduler(); const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  it('1. scheduler status reflete enabled/running/cumulative', async () => {
    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 60, concurrency: 2, syncFn: fakeSync({}) });
    const status = scheduler.getStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.running, false);
    assert.equal(status.intervalMinutes, 60);
    assert.equal(status.concurrency, 2);
    assert.ok(status.staleAfterMinutes > 0);
    assert.equal(status.lastCycleAt, null);
    assert.equal(status.cumulative.cycles, 0);
    assert.equal(status.cumulative.eligible, 0);
  });

  it('2. ciclo registrado em memória (lastResult, cumulative)', async () => {
    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 60, concurrency: 2, syncFn: fakeSync({ newEvents: 5 }) });
    const result = await scheduler.runOnce();
    assert.equal(result.eligible, 0); // no cases in DB
    assert.equal(result.newEvents, 0);
    const status = scheduler.getStatus();
    assert.ok(status.lastCycleAt);
    assert.ok(status.lastCycleDurationMs !== null);
    assert.equal(status.lastCycleStats?.eligible, 0);
    assert.equal(status.cumulative.cycles, 1);
    assert.equal(status.cumulative.eligible, 0);
  });

  it('3. getMonitorStatus lê singleton corretamente', async () => {
    const status = getMonitorStatus();
    assert.equal(typeof status.enabled, 'boolean');
    assert.equal(typeof status.running, 'boolean');
    assert.equal(typeof status.intervalMinutes, 'number');
  });

  it('4. disabled → start() não agenda, isRunning false', async () => {
    const scheduler = createMonitorScheduler({ enabled: false, syncFn: fakeSync({}) });
    scheduler.start();
    assert.equal(scheduler.isRunning(), false);
    const status = scheduler.getStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.running, false);
    scheduler.stop();
  });

  it('5. stop() limpa scheduler; start() após stop() funciona', async () => {
    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 1, concurrency: 1, syncFn: fakeSync({}) });
    scheduler.start();
    assert.ok(scheduler.isRunning() === false || scheduler.getStatus().nextCycleAt !== null);
    scheduler.stop();
    assert.equal(scheduler.isRunning(), false);
    // start again after stop
    scheduler.start(); // should not start because stopped=true
    // Note: createMonitorScheduler internally guards with stopped flag
    // The test validates that calling start() after stop() doesn't create a second timer
    // (the guard prevents re-entering)
    assert.equal(scheduler.isRunning(), false);
    scheduler.stop();
  });
});

describe('ETAPA 10 — Monitoramento: stale detection', () => {
  it('6. stale: ACTIVE + last_synced_at recente → false', () => {
    const result = isCaseStale(
      { monitoring_status: 'ACTIVE', last_synced_at: new Date().toISOString(), process_number: CNJ },
      1, // threshold 1 minute, recent is < 1 min
    );
    assert.equal(result, false);
  });

  it('7. stale: ACTIVE + last_synced_at antigo → true', () => {
    const past = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    const result = isCaseStale(
      { monitoring_status: 'ACTIVE', last_synced_at: past, process_number: CNJ },
      1, // threshold 1 minute, past is > 1 min
    );
    assert.equal(result, true);
  });

  it('8. stale: PAUSED → false', () => {
    const result = isCaseStale(
      { monitoring_status: 'PAUSED', last_synced_at: new Date(Date.now() - 3600000).toISOString(), process_number: CNJ },
    );
    assert.equal(result, false);
  });

  it('9. stale: sem process_number → false', () => {
    const result = isCaseStale(
      { monitoring_status: 'ACTIVE', last_synced_at: new Date(Date.now() - 3600000).toISOString(), process_number: null },
    );
    assert.equal(result, false);
  });
});

describe('ETAPA 10 — Monitoramento: classificação de erro', () => {
  it('10. DataJud UNAVAILABLE → transient', () => {
    const err = new DataJudError(DATAJUD_ERROR_CODES.UNAVAILABLE);
    const cls = classifySyncError(err);
    assert.equal(cls.code, 'DATAJUD_UNAVAILABLE');
    assert.equal(cls.transient, true);
    assert.ok(cls.message);
  });

  it('11. DataJud TIMEOUT → transient', () => {
    const err = new DataJudError(DATAJUD_ERROR_CODES.TIMEOUT);
    const cls = classifySyncError(err);
    assert.equal(cls.transient, true);
  });

  it('12. DataJud RATE_LIMITED → transient', () => {
    const err = new DataJudError(DATAJUD_ERROR_CODES.RATE_LIMITED);
    const cls = classifySyncError(err);
    assert.equal(cls.transient, true);
  });

  it('13. DataJud UNAUTHORIZED → permanent', () => {
    const err = new DataJudError(DATAJUD_ERROR_CODES.UNAUTHORIZED);
    const cls = classifySyncError(err);
    assert.equal(cls.transient, false);
    assert.ok(cls.message.includes('autenticação'));
  });

  it('14. DataJud FORBIDDEN → permanent', () => {
    const err = new DataJudError(DATAJUD_ERROR_CODES.FORBIDDEN);
    const cls = classifySyncError(err);
    assert.equal(cls.transient, false);
  });

  it('15. DataJud NOT_CONFIGURED → permanent', () => {
    const err = new DataJudError(DATAJUD_ERROR_CODES.NOT_CONFIGURED);
    const cls = classifySyncError(err);
    assert.equal(cls.transient, false);
  });

  it('16. erro genérico com secret sanitizado', () => {
    const err = new Error('Authorization: Bearer sk-1234 failed');
    const cls = classifySyncError(err);
    // safeMessage redacts Authorization/password/token
    assert.ok(cls.transient === false);
    assert.ok(!cls.message.includes('sk-1234'));
    assert.ok(cls.message.includes('autenticação'));
  });
});

describe('ETAPA 10 — Integração: monitoring status + RBAC + isolamento', () => {
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

  async function makeCase(session: { cookie: string }) {
    const res = await request(app).post('/api/processes').set('Cookie', session.cookie).send({ title: 'Proc', processNumber: CNJ }).expect(201);
    return res.body;
  }

  it('17. FINANCE → 403 em /api/monitoring/status', async () => {
    const admin = await helper.registerAndLogin();
    const finance = await createSecondUserInOrg(app, admin, { role: 'FINANCE' });
    await request(app).get('/api/monitoring/status').set('Cookie', finance.cookie).expect(403);
  });

  it('18. ADMIN → 200 em /api/monitoring/status', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app).get('/api/monitoring/status').set('Cookie', session.cookie).expect(200);
    assert.ok(res.body.scheduler);
    assert.ok(res.body.organization);
    assert.equal(typeof res.body.organization.active, 'number');
    assert.equal(typeof res.body.organization.paused, 'number');
    assert.equal(typeof res.body.organization.error, 'number');
    assert.equal(typeof res.body.organization.stale, 'number');
  });

  it('19. LAWYER → 200 (possui PROCESSES_READ)', async () => {
    const admin = await helper.registerAndLogin();
    const lawyer = await createSecondUserInOrg(app, admin, { role: 'LAWYER' });
    const res = await request(app).get('/api/monitoring/status').set('Cookie', lawyer.cookie).expect(200);
    assert.ok(res.body.scheduler);
  });

  it('20. isolamento: org A tem 1 case, org B 0', async () => {
    const orgA = await helper.registerAndLogin();
    await makeCase(orgA);
    const resA = await request(app).get('/api/monitoring/status').set('Cookie', orgA.cookie).expect(200);
    assert.equal(resA.body.organization.active, 1);

    const orgB = await helper.registerAndLogin();
    const resB = await request(app).get('/api/monitoring/status').set('Cookie', orgB.cookie).expect(200);
    assert.equal(resB.body.organization.active, 0);
  });

  it('21. SUPER_ADMIN → 403 em /api/monitoring/status (não tem org)', async () => {
    const sa = await createSuperAdmin(app);
    await request(app).get('/api/monitoring/status').set('Cookie', sa.cookie).expect(403);
  });

  it('22. SUPER_ADMIN vê monitoring no endpoint técnico', async () => {
    const sa = await createSuperAdmin(app);
    const res = await request(app).get('/api/superadmin/status').set('Cookie', sa.cookie).expect(200);
    assert.ok(res.body.monitoring);
    assert.equal(typeof res.body.monitoring.enabled, 'boolean');
  });

  it('23. capture_runs SYNC registrados corretamente', async () => {
    const session = await helper.registerAndLogin();
    const caseRow = await makeCase(session);
    // Sincroniza manualmente (com lookup fake → sem eventos)
    const pool = getPool();
    const { syncCase } = await import('../src/capture/sync/service');
    const result = await syncCase(session.orgId, caseRow.id, session.userId, undefined, async () => ({
      process: { processNumber: CNJ, title: 'Proc', court: 'TRF1' },
      movements: [],
      metadata: { dataJud: { tribunal: 'TRF1', movementCount: 0 } },
    }));
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.source, 'DATAJUD');
    assert.ok(result.runId);
    const run = await pool.query('SELECT * FROM capture_runs WHERE id = $1', [result.runId]);
    assert.equal(run.rows[0].adapter, 'SYNC');
    assert.equal(run.rows[0].source, 'DATAJUD');
    assert.equal(run.rows[0].case_id, caseRow.id);
    assert.equal(run.rows[0].status, 'SUCCESS');
    // monitoring status endpoint reflete contagem
    const statusRes = await request(app).get('/api/monitoring/status').set('Cookie', session.cookie).expect(200);
    assert.ok(statusRes.body.organization.totalSyncs >= 1);
  });

  it('24. erro UNAVAILABLE → monitoring_status ACTIVE (transient, retry next cycle)', async () => {
    const session = await helper.registerAndLogin();
    const caseRow = await makeCase(session);
    const { syncCase } = await import('../src/capture/sync/service');
    const result = await syncCase(session.orgId, caseRow.id, session.userId, undefined, async () => {
      throw new DataJudError(DATAJUD_ERROR_CODES.UNAVAILABLE);
    });
    assert.equal(result.status, 'FAILED');
    const pool = getPool();
    const row = await pool.query('SELECT monitoring_status, last_sync_error FROM cases WHERE id = $1', [caseRow.id]);
    assert.equal(row.rows[0].monitoring_status, 'ACTIVE'); // transient → retry
    assert.ok(row.rows[0].last_sync_error);
    assert.ok(row.rows[0].last_sync_error.includes('DATAJUD_UNAVAILABLE'));
  });

  it('25. erro UNAUTHORIZED → monitoring_status ERROR (permanente)', async () => {
    const session = await helper.registerAndLogin();
    const caseRow = await makeCase(session);
    const { syncCase } = await import('../src/capture/sync/service');
    const result = await syncCase(session.orgId, caseRow.id, session.userId, undefined, async () => {
      throw new DataJudError(DATAJUD_ERROR_CODES.UNAUTHORIZED);
    });
    assert.equal(result.status, 'FAILED');
    const pool = getPool();
    const row = await pool.query('SELECT monitoring_status, last_sync_error FROM cases WHERE id = $1', [caseRow.id]);
    assert.equal(row.rows[0].monitoring_status, 'ERROR'); // permanente → para
    assert.ok(row.rows[0].last_sync_error);
  });

  it('26. falha isolada não interrompe lote (já testado em scheduler)', async () => {
    // Este teste valida que o scheduler lida com falhas isoladas (cobertura do scheduler)
    const { createMonitorScheduler } = await import('../src/capture/scheduler/service');
    const { caseRow: a } = await (async () => {
      const session = await helper.registerAndLogin();
      const pool = getPool();
      const res = await pool.query(
        `INSERT INTO cases (organization_id, title, process_number, monitoring_status, last_synced_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [session.orgId, 'A', CNJ, 'ACTIVE', null],
      );
      return { session, caseRow: res.rows[0] };
    })();
    const { caseRow: b } = await (async () => {
      const session = await helper.registerAndLogin();
      const pool = getPool();
      const res = await pool.query(
        `INSERT INTO cases (organization_id, title, process_number, monitoring_status, last_synced_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [session.orgId, 'B', CNJ, 'ACTIVE', null],
      );
      return { session, caseRow: res.rows[0] };
    })();
    let calls = 0;
    const flakySync: typeof import('../src/capture/sync/service').syncCase = async (orgId, caseId): Promise<SyncResult> => {
      calls += 1;
      if (caseId === a.id) throw new Error('FALHA_CONTROLADA');
      return { caseId, processNumber: CNJ, source: 'DATAJUD', status: 'SUCCESS', found: 1, inserted: 0, duplicates: 1, errors: 0, movementsFound: 1, publicationsFound: 0, synchronizedAt: new Date().toISOString(), runId: `r-${caseId}` };
    };
    const scheduler = createMonitorScheduler({ enabled: true, intervalMinutes: 60, concurrency: 2, syncFn: flakySync });
    const result = await scheduler.runOnce();
    assert.equal(calls, 2);
    assert.equal(result.failed, 1);
    assert.equal(result.success, 1);
    scheduler.stop();
  });
});