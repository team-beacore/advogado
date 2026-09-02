import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, createSecondUserInOrg, createSuperAdmin, makeApp, resetDb } from './helpers';
import { getPool } from '../src/db/client';
import { syncCase } from '../src/capture/sync/service';
import { DataJudError, DATAJUD_ERROR_CODES } from '../src/capture/datajud/errors';
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

describe('ETAPA 8 — Validação final: falhas + notificações', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);
  const emailChannel = new FakeEmailChannel();

  before(async () => {
    await resetDb();
    setNotificationChannelsForTests([emailChannel]);
  });
  after(async () => {
    setNotificationChannelsForTests(null);
    const { closePool } = await import('../src/db/client');
    await closePool();
  });
  beforeEach(async () => {
    await resetDb();
    emailChannel.lastMessage = null;
    emailChannel.sentCount = 0;
  });

  async function makeCase(session: { cookie: string }, responsibleId?: string) {
    const res = await request(app).post('/api/processes').set('Cookie', session.cookie).send({
      title: 'Processo Validação',
      processNumber: CNJ,
      responsibleId: responsibleId ?? undefined,
    }).expect(201);
    return res.body;
  }

  /** Constrói um resultado "fake" de provider (teste controlado — nunca produção). */
  function fakeLookup(overrides: { movements?: Array<{ description: string; date?: string | null; sourceReference?: string | null }>; throwError?: boolean }) {
    return async () => {
      if (overrides.throwError) throw new DataJudError(DATAJUD_ERROR_CODES.UNAVAILABLE);
      return {
        process: { processNumber: CNJ, title: 'Processo Validação', court: 'TRF1' },
        movements: (overrides.movements ?? []).map((m) => ({
          processNumber: CNJ,
          date: m.date ?? '2026-09-01T10:00:00.000Z',
          description: m.description,
          sourceReference: m.sourceReference ?? null,
        })),
        metadata: { dataJud: { tribunal: 'TRF1', movementCount: (overrides.movements ?? []).length } },
      };
    };
  }

  it('1. Falha DataJud → sync FAILED; capture_run SYNC/DATAJUD; case_id; error_count; last_sync_error; eventos preservados', async () => {
    const session = await helper.registerAndLogin();
    const caseRow = await makeCase(session);

    // Simula eventos já existentes (como os 43 reais) — devem ser preservados.
    const pool = getPool();
    await pool.query(
      `INSERT INTO case_events (process_id, type, title, description, source, source_reference)
       VALUES ($1, 'CAPTURE_MOVEMENT', 'Movimento existente', 'Movimento existente', 'DATAJUD', 'datajud-mov-26-2026-01-01')`,
      [caseRow.id],
    );
    const beforeEvents = await pool.query('SELECT count(*)::int AS n FROM case_events WHERE process_id = $1', [caseRow.id]);

    // Força falha controlada: lookup lança DataJudError (equivale a HTTP 503/timeout/401 tratado).
    const result = await syncCase(session.orgId, caseRow.id, session.userId, undefined, fakeLookup({ throwError: true }));
    assert.equal(result.status, 'FAILED');
    assert.ok(result.runId);

    const run = await pool.query('SELECT * FROM capture_runs WHERE id = $1', [result.runId]);
    assert.equal(run.rows[0].adapter, 'SYNC');
    assert.equal(run.rows[0].source, 'DATAJUD');
    assert.equal(run.rows[0].case_id, caseRow.id);
    assert.equal(run.rows[0].status, 'FAILED');
    assert.ok(run.rows[0].error_count > 0);
    assert.ok(run.rows[0].error_message);

    const caseRowDb = await pool.query('SELECT last_synced_at, monitoring_status, last_sync_error FROM cases WHERE id = $1', [caseRow.id]);
    assert.equal(caseRowDb.rows[0].monitoring_status, 'ERROR');
    assert.ok(caseRowDb.rows[0].last_sync_error);

    // Eventos existentes NÃO foram apagados.
    const afterEvents = await pool.query('SELECT count(*)::int AS n FROM case_events WHERE process_id = $1', [caseRow.id]);
    assert.equal(afterEvents.rows[0].n, beforeEvents.rows[0].n);

    // Auditoria PROCESS_SYNC_FAILED
    const audit = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE organization_id = $1 AND action = 'PROCESS_SYNC_FAILED'`, [session.orgId]);
    assert.ok(audit.rows[0].n >= 1);
  });

  it('2. Sucesso + 0 novos = SUCCESS; falha = FAILED (nunca trata erro como "sem movimentação")', async () => {
    const session = await helper.registerAndLogin();
    const caseRow = await makeCase(session);

    const okZero = await syncCase(session.orgId, caseRow.id, session.userId, undefined, fakeLookup({ movements: [] }));
    assert.equal(okZero.status, 'SUCCESS');
    assert.equal(okZero.inserted, 0);

    const fail = await syncCase(session.orgId, caseRow.id, session.userId, undefined, fakeLookup({ throwError: true }));
    assert.equal(fail.status, 'FAILED');
  });

  it('3. Notificação: novo evento → responsável (A) recebe; executor (B) NÃO recebe automaticamente', async () => {
    const admin = await helper.registerAndLogin();
    const caseRow = await makeCase(admin, admin.userId); // responsável = A
    const executor = await createSecondUserInOrg(app, admin, { role: 'LAWYER' }); // B executa

    const result = await syncCase(admin.orgId, caseRow.id, executor.userId, undefined, fakeLookup({
      movements: [{ description: 'Juntada de documento', sourceReference: 'datajud-mov-77-2026-09-02T09:00:00.000Z' }],
    }));
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.inserted, 1);

    // Notificação criada para o responsável (A), não para o executor (B)
    const pool = getPool();
    const notif = await pool.query(
      `SELECT * FROM notifications WHERE process_id = $1 AND type = 'PROCESS_MOVEMENT' AND user_id = $2`,
      [caseRow.id, admin.userId],
    );
    assert.ok(notif.rows.length >= 1);

    // Email enviado APENAS para A
    assert.equal(emailChannel.sentCount, 1);
    assert.equal(emailChannel.lastMessage?.to, admin.email);
    assert.notEqual(admin.email, executor.email);

    // Nenhuma entrega para B
    const bDeliveries = await pool.query(
      `SELECT count(*)::int AS n FROM notification_deliveries WHERE user_id = $1`,
      [executor.userId],
    );
    assert.equal(bDeliveries.rows[0].n, 0);
  });

  it('4. Email desabilitado → NÃO envia email (mas sincronização segue)', async () => {
    const admin = await helper.registerAndLogin();
    const caseRow = await makeCase(admin, admin.userId);
    await request(app).put('/api/notifications/preferences').set('Cookie', admin.cookie).send({ emailEnabled: false }).expect(200);

    const result = await syncCase(admin.orgId, caseRow.id, admin.userId, undefined, fakeLookup({
      movements: [{ description: 'Novo movimento', sourceReference: 'datajud-mov-78-2026-09-02T10:00:00.000Z' }],
    }));
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.inserted, 1);
    assert.equal(emailChannel.sentCount, 0); // email desabilitado → sem dispatch
  });

  it('5. Auditoria: STARTED/FETCHED/COMPLETED e MOVEMENT_IMPORTED no sucesso', async () => {
    const session = await helper.registerAndLogin();
    const caseRow = await makeCase(session);

    await syncCase(session.orgId, caseRow.id, session.userId, undefined, fakeLookup({
      movements: [{ description: 'Movimento novo', sourceReference: 'datajud-mov-79-2026-09-02T11:00:00.000Z' }],
    }));

    const pool = getPool();
    for (const action of ['PROCESS_SYNC_STARTED', 'PROCESS_SYNC_FETCHED', 'PROCESS_SYNC_COMPLETED', 'PROCESS_MOVEMENT_IMPORTED']) {
      const r = await pool.query('SELECT count(*)::int AS n FROM audit_logs WHERE organization_id = $1 AND action = $2', [session.orgId, action]);
      assert.ok(r.rows[0].n >= 1, `esperava auditoria ${action}`);
    }
  });

  it('8a. RBAC: FINANCE → 403; usuário sem acesso ao case → 403; autorizado → permitido', async () => {
    const admin = await helper.registerAndLogin();
    const caseRow = await makeCase(admin, admin.userId);

    // FINANCE → 403
    const finance = await createSecondUserInOrg(app, admin, { role: 'FINANCE' });
    await request(app).post(`/api/processes/${caseRow.id}/sync`).set('Cookie', finance.cookie).send().expect(403);

    // LAWYER sem acesso ao case → 403
    const lawyer = await createSecondUserInOrg(app, admin, { role: 'LAWYER', email: 'lawyer-nocase@test.local' });
    await request(app).post(`/api/processes/${caseRow.id}/sync`).set('Cookie', lawyer.cookie).send().expect(403);

    // Autorizado (responsável = admin) → permitido (retorna 200)
    await request(app).post(`/api/processes/${caseRow.id}/sync`).set('Cookie', admin.cookie).send().expect(200);
  });

  it('8b. SUPER_ADMIN não acessa rota jurídica normal como membro da organização', async () => {
    const sa = await createSuperAdmin(app);
    // SUPER_ADMIN sem organização → requireOrg bloqueia (403)
    await request(app).post('/api/processes/00000000-0000-0000-0000-000000000000/sync').set('Cookie', sa.cookie).send().expect(403);
  });

  it('9. Isolamento: case da organização A não pode ser sincronizado por usuário da organização B', async () => {
    const orgA = await helper.registerAndLogin();
    const caseRow = await makeCase(orgA, orgA.userId);
    const orgB = await helper.registerAndLogin();

    // Usuário da org B tenta sincronizar case da org A → 404 (case inexistente na org B)
    const res = await request(app).post(`/api/processes/${caseRow.id}/sync`).set('Cookie', orgB.cookie).send();
    assert.equal(res.status, 404);
  });
});
