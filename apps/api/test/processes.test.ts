import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb } from './helpers';

describe('Processes', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  async function createProcess(session: { cookie: string }, overrides: Record<string, unknown> = {}) {
    const res = await request(app)
      .post('/api/processes')
      .set('Cookie', session.cookie)
      .send({ title: 'Processo Teste', processNumber: '1234567-89.2024.8.01.0001', court: 'TJSP', area: 'Cível', ...overrides })
      .expect(201);
    return res.body;
  }

  it('creates a process', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createProcess(session);
    assert.equal(proc.title, 'Processo Teste');
    assert.equal(proc.organization_id, session.orgId);
    assert.equal(proc.status, 'ACTIVE');
  });

  it('creates PROCESS_CREATED timeline event', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createProcess(session);
    const detail = await request(app).get(`/api/processes/${proc.id}`).set('Cookie', session.cookie).expect(200);
    assert.ok(detail.body.events.some((e: { type: string }) => e.type === 'PROCESS_CREATED'));
  });

  it('rejects duplicate process number in same org', async () => {
    const session = await helper.registerAndLogin();
    await createProcess(session);
    const res = await request(app)
      .post('/api/processes')
      .set('Cookie', session.cookie)
      .send({ title: 'Outro', processNumber: '1234567-89.2024.8.01.0001' });
    assert.equal(res.status, 409);
  });

  it('allows same process number in different orgs', async () => {
    const a = await helper.registerAndLogin();
    const b = await helper.registerAndLogin();
    await createProcess(a);
    const res = await request(app)
      .post('/api/processes')
      .set('Cookie', b.cookie)
      .send({ title: 'Proc B', processNumber: '1234567-89.2024.8.01.0001' });
    assert.equal(res.status, 201);
  });

  it('lists processes with search and filters', async () => {
    const session = await helper.registerAndLogin();
    await createProcess(session, { area: 'Cível' });
    await createProcess(session, { area: 'Trabalhista', processNumber: '9999999-00.2024.5.01.0001' });

    const list = await request(app).get('/api/processes').set('Cookie', session.cookie).expect(200);
    assert.equal(list.body.total, 2);

    const filter = await request(app).get('/api/processes?area=TRABALHISTA').set('Cookie', session.cookie).expect(200);
    assert.equal(filter.body.total, 1);

    const search = await request(app).get('/api/processes?search=9999999').set('Cookie', session.cookie).expect(200);
    assert.equal(search.body.total, 1);
  });

  it('updates process status and logs event', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createProcess(session);
    const upd = await request(app)
      .patch(`/api/processes/${proc.id}`)
      .set('Cookie', session.cookie)
      .send({ status: 'SUSPENDED' })
      .expect(200);
    assert.equal(upd.body.status, 'SUSPENDED');
    const detail = await request(app).get(`/api/processes/${proc.id}`).set('Cookie', session.cookie).expect(200);
    assert.ok(detail.body.events.some((e: { type: string }) => e.type === 'STATUS_CHANGED'));
  });
});