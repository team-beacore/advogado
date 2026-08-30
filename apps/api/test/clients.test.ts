import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb } from './helpers';

describe('Clients', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  it('creates a client', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app)
      .post('/api/clients')
      .set('Cookie', session.cookie)
      .send({ name: 'Maria Souza', email: 'maria@example.com', phone: '11 99999-0000', cpfCnpj: '123.456.789-00' })
      .expect(201);
    assert.equal(res.body.name, 'Maria Souza');
    assert.equal(res.body.organization_id, session.orgId);
  });

  it('rejects invalid client payload', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app)
      .post('/api/clients')
      .set('Cookie', session.cookie)
      .send({ name: '' })
      .expect(400);
    assert.equal(res.body.code, 'VALIDATION');
  });

  it('lists and searches clients', async () => {
    const session = await helper.registerAndLogin();
    await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Ana' }).expect(201);
    await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Bruno' }).expect(201);

    const list = await request(app).get('/api/clients').set('Cookie', session.cookie).expect(200);
    assert.equal(list.body.total, 2);

    const search = await request(app).get('/api/clients?search=bruno').set('Cookie', session.cookie).expect(200);
    assert.equal(search.body.total, 1);
    assert.equal(search.body.items[0].name, 'Bruno');
  });

  it('gets client detail with linked cases', async () => {
    const session = await helper.registerAndLogin();
    const client = await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Carlos' }).expect(201);
    await request(app)
      .post('/api/processes')
      .set('Cookie', session.cookie)
      .send({ clientId: client.body.id, title: 'Proc 1', processNumber: '0001-01.2024.8.01.0001' })
      .expect(201);

    const detail = await request(app).get(`/api/clients/${client.body.id}`).set('Cookie', session.cookie).expect(200);
    assert.equal(detail.body.cases.length, 1);
    assert.equal(detail.body.name, 'Carlos');
  });

  it('updates a client', async () => {
    const session = await helper.registerAndLogin();
    const client = await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Antes' }).expect(201);
    const upd = await request(app)
      .patch(`/api/clients/${client.body.id}`)
      .set('Cookie', session.cookie)
      .send({ name: 'Depois', email: 'novo@example.com' })
      .expect(200);
    assert.equal(upd.body.name, 'Depois');
  });
});