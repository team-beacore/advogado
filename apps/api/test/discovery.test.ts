import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, createSecondUserInOrg, createSuperAdmin, makeApp, resetDb } from './helpers';
import { getPool } from '../src/db/client';

describe('DESCOBERTA DE PROCESSOS — identidade profissional, descoberta, importação, RBAC', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  it('SOLO: cadastra identidade profissional (OAB/UF) e lê de volta', async () => {
    const session = await helper.registerAndLogin();
    await request(app).put('/api/professional-identity/me').set('Cookie', session.cookie).send({
      professionalName: 'Dr. João Silva',
      oabNumber: '123456',
      oabState: 'RJ',
    }).expect(201);
    const me = await request(app).get('/api/professional-identity/me').set('Cookie', session.cookie).expect(200);
    assert.equal(me.body.identity.oab_number, '123456');
    assert.equal(me.body.identity.oab_state, 'RJ');
  });

  it('descoberta exige identidade profissional configurada', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app).post('/api/process-discovery/run').set('Cookie', session.cookie).send({ source: 'DEMO' }).expect(400);
    assert.equal(res.body.code, 'VALIDATION');
    assert.ok(res.body.message.includes('Identidade profissional'));
  });

  it('run DEMO descobre processos (resultados PENDING_REVIEW); fontes não implementadas são SKIPPED honestamente', async () => {
    const session = await helper.registerAndLogin();
    await request(app).put('/api/professional-identity/me').set('Cookie', session.cookie).send({
      professionalName: 'Dr. João Silva', oabNumber: '123456', oabState: 'RJ',
    }).expect(201);

    const res = await request(app).post('/api/process-discovery/run').set('Cookie', session.cookie).send({}).expect(200);
    assert.equal(res.body.status, 'SUCCESS');
    assert.equal(res.body.processesFound, 3);
    assert.equal(res.body.resultsCreated, 3);
    // fontes reais não implementadas não fingem descoberta
    assert.ok(res.body.steps.some((s: { status: string }) => s.status === 'SKIPPED'));

    const results = await request(app).get('/api/process-discovery/results').set('Cookie', session.cookie).expect(200);
    assert.equal(results.body.items.length, 3);
    assert.ok(results.body.items.every((r: { status: string }) => r.status === 'PENDING_REVIEW'));

    const status = await request(app).get('/api/process-discovery/status').set('Cookie', session.cookie).expect(200);
    const datajud = status.body.providers.find((p: { source: string }) => p.source === 'DATAJUD');
    assert.equal(datajud.capabilities.supportsProfessionalDiscovery, false);
    assert.equal(datajud.capabilities.supportsProcessLookup, true);
  });

  it('segunda descoberta DEMO não duplica resultados', async () => {
    const session = await helper.registerAndLogin();
    await request(app).put('/api/professional-identity/me').set('Cookie', session.cookie).send({
      professionalName: 'Dr. João Silva', oabNumber: '123456', oabState: 'RJ',
    }).expect(201);
    await request(app).post('/api/process-discovery/run').set('Cookie', session.cookie).send({}).expect(200);
    const second = await request(app).post('/api/process-discovery/run').set('Cookie', session.cookie).send({}).expect(200);
    assert.equal(second.body.resultsCreated, 0);
    const results = await request(app).get('/api/process-discovery/results').set('Cookie', session.cookie).expect(200);
    assert.equal(results.body.items.length, 3);
  });

  it('importação cria Case com número CNJ; responsável não é assumido automaticamente', async () => {
    const session = await helper.registerAndLogin();
    await request(app).put('/api/professional-identity/me').set('Cookie', session.cookie).send({
      professionalName: 'Dr. João Silva', oabNumber: '123456', oabState: 'RJ',
    }).expect(201);
    await request(app).post('/api/process-discovery/run').set('Cookie', session.cookie).send({}).expect(200);
    const results = await request(app).get('/api/process-discovery/results').set('Cookie', session.cookie).expect(200);
    const id = results.body.items[0].id;

    const imp = await request(app).post(`/api/process-discovery/results/${id}/import`).set('Cookie', session.cookie).send({}).expect(200);
    assert.equal(imp.body.created, true);

    const pool = getPool();
    const caseRow = await pool.query('SELECT process_number, responsible_id FROM cases WHERE organization_id = $1', [session.orgId]);
    assert.equal(caseRow.rows.length, 1);
    // responsável NÃO é assumido como quem importou
    assert.equal(caseRow.rows[0].responsible_id, null);

    // movimentações descobertas foram importadas como eventos
    // Contrato real de GET /processes/:id/events: retorna ARRAY (não envelope {items}).
    const events = await request(app).get(`/api/processes/${imp.body.caseId}/events`).set('Cookie', session.cookie).expect(200);
    assert.ok(Array.isArray(events.body));
    assert.ok(events.body.length > 0);
  });

  it('importar duas vezes o mesmo resultado é idempotente (não cria duplicata)', async () => {
    const session = await helper.registerAndLogin();
    await request(app).put('/api/professional-identity/me').set('Cookie', session.cookie).send({
      professionalName: 'Dr. João Silva', oabNumber: '123456', oabState: 'RJ',
    }).expect(201);
    await request(app).post('/api/process-discovery/run').set('Cookie', session.cookie).send({}).expect(200);
    const results = await request(app).get('/api/process-discovery/results').set('Cookie', session.cookie).expect(200);
    const id = results.body.items[0].id;

    await request(app).post(`/api/process-discovery/results/${id}/import`).set('Cookie', session.cookie).send({}).expect(200);
    const again = await request(app).post(`/api/process-discovery/results/${id}/import`).set('Cookie', session.cookie).send({}).expect(200);
    assert.equal(again.body.alreadyImported, true);

    const pool = getPool();
    const count = await pool.query('SELECT count(*)::int AS n FROM cases WHERE organization_id = $1', [session.orgId]);
    assert.equal(count.rows[0].n, 1);
  });

  it('importação de resultado cujo número já existe no caso vira DUPLICATE', async () => {
    const session = await helper.registerAndLogin();
    // cria manualmente um caso com o mesmo número CNJ do DEMO
    await request(app).post('/api/processes').set('Cookie', session.cookie).send({
      title: 'Já existente', processNumber: '0000000-00.2026.8.00.0001',
    }).expect(201);
    await request(app).put('/api/professional-identity/me').set('Cookie', session.cookie).send({
      professionalName: 'Dr. João Silva', oabNumber: '123456', oabState: 'RJ',
    }).expect(201);
    await request(app).post('/api/process-discovery/run').set('Cookie', session.cookie).send({}).expect(200);
    const results = await request(app).get('/api/process-discovery/results').set('Cookie', session.cookie).send({}).expect(200);
    const demo = results.body.items.find((r: { process_number: string }) => r.process_number === '0000000-00.2026.8.00.0001');
    const imp = await request(app).post(`/api/process-discovery/results/${demo.id}/import`).set('Cookie', session.cookie).send({}).expect(200);
    assert.equal(imp.body.duplicate, true);
  });

  it('OFFICE: ASSISTANT não pode executar descoberta por padrão (permissão)', async () => {
    const admin = await helper.registerAndLogin();
    await request(app).put('/api/professional-identity/me').set('Cookie', admin.cookie).send({
      professionalName: 'Dr. João Silva', oabNumber: '123456', oabState: 'RJ',
    }).expect(201);
    const assistant = await createSecondUserInOrg(app, admin, { role: 'ASSISTANT' });
    await request(app).post('/api/process-discovery/run').set('Cookie', assistant.cookie).send({ source: 'DEMO' }).expect(403);
  });

  it('FINANCE não acessa descoberta', async () => {
    const admin = await helper.registerAndLogin();
    const finance = await createSecondUserInOrg(app, admin, { role: 'FINANCE' });
    await request(app).get('/api/process-discovery/status').set('Cookie', finance.cookie).expect(403);
    await request(app).get('/api/process-discovery/results').set('Cookie', finance.cookie).expect(403);
  });

  it('SUPER ADMIN não executa descoberta de organização (fora da organização)', async () => {
    const sa = await createSuperAdmin(app);
    await request(app).post('/api/process-discovery/run').set('Cookie', sa.cookie).send({ source: 'DEMO' }).expect(403);
  });
});
