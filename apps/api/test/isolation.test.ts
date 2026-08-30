import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb } from './helpers';

describe('Multi-tenancy / Authorization', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  it('org A cannot access org B clients', async () => {
    const orgA = await helper.registerAndLogin();
    const orgB = await helper.registerAndLogin();

    const createRes = await request(app)
      .post('/api/clients')
      .set('Cookie', orgA.cookie)
      .send({ name: 'Cliente A', email: 'a@a.com' })
      .expect(201);
    const clientId = createRes.body.id;

    // B tries to access A's client
    const getRes = await request(app).get(`/api/clients/${clientId}`).set('Cookie', orgB.cookie);
    assert.equal(getRes.status, 404);

    // B lists clients - should be empty
    const listRes = await request(app).get('/api/clients').set('Cookie', orgB.cookie).expect(200);
    assert.equal(listRes.body.items.length, 0);
  });

  it('org A cannot access org B processes', async () => {
    const orgA = await helper.registerAndLogin();
    const orgB = await helper.registerAndLogin();

    const clientRes = await request(app)
      .post('/api/clients')
      .set('Cookie', orgA.cookie)
      .send({ name: 'Cliente' })
      .expect(201);

    const caseRes = await request(app)
      .post('/api/processes')
      .set('Cookie', orgA.cookie)
      .send({ clientId: clientRes.body.id, title: 'Processo A', processNumber: '1111111-11.2024.8.01.0001' })
      .expect(201);
    const caseId = caseRes.body.id;

    const getRes = await request(app).get(`/api/processes/${caseId}`).set('Cookie', orgB.cookie);
    assert.equal(getRes.status, 404);

    const eventsRes = await request(app).get(`/api/processes/${caseId}/events`).set('Cookie', orgB.cookie);
    assert.equal(eventsRes.status, 404);
  });

  it('unauthenticated user cannot access any resource', async () => {
    await request(app).get('/api/clients').expect(401);
    await request(app).get('/api/processes').expect(401);
    await request(app).get('/api/tasks').expect(401);
    await request(app).get('/api/publications').expect(401);
    await request(app).get('/api/documents').expect(401);
    await request(app).get('/api/audit').expect(401);
  });

  it('user without organization cannot create resources', async () => {
    // register + login but do NOT create org (organizationId null)
    const email = `noorg${Date.now()}@test.local`;
    await request(app).post('/api/auth/register').send({ name: 'No Org', email, password: 'test1234' }).expect(201);
    const login = await request(app).post('/api/auth/login').send({ email, password: 'test1234' }).expect(200);
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0]!;
    await request(app).post('/api/clients').set('Cookie', cookie).send({ name: 'X' }).expect(403);
  });
});