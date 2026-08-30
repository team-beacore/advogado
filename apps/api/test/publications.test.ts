import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb } from './helpers';

describe('Intimações (legal publications)', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  async function createCase(session: { cookie: string }) {
    const res = await request(app)
      .post('/api/processes')
      .set('Cookie', session.cookie)
      .send({ title: 'Proc Pub', processNumber: '3333-33.2024.8.01.0001' })
      .expect(201);
    return res.body;
  }

  it('registers an intimação linked to a process', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    const res = await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({
        processId: proc.id,
        source: 'DJSP',
        availabilityDate: new Date().toISOString(),
        publicationDate: new Date().toISOString(),
        content: 'Prazo de 15 dias para manifestação.',
        externalReference: '2024.0001.0001',
        possibleDueDate: new Date(Date.now() + 15 * 86400000).toISOString(),
      })
      .expect(201);
    assert.equal(res.body.source, 'DJSP');
    assert.equal(res.body.status, 'PENDING');
    assert.equal(res.body.process_id, proc.id);
  });

  it('adds timeline event when intimação is registered', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.id, content: 'Intimação de sentença' })
      .expect(201);
    const detail = await request(app).get(`/api/processes/${proc.id}`).set('Cookie', session.cookie).expect(200);
    assert.ok(detail.body.events.some((e: { type: string }) => e.type === 'PUBLICATION_REGISTERED'));
  });

  it('creates a notification for pending intimação', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.id, content: 'Teste', possibleDueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);
    const notifications = await request(app).get('/api/notifications').set('Cookie', session.cookie).expect(200);
    assert.ok(notifications.body.items.some((n: { type: string }) => n.type === 'PUBLICATION_PENDING'));
  });

  it('marks intimação as processed', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    const pub = await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.id, content: 'Intimação' })
      .expect(201);
    await request(app)
      .patch(`/api/publications/${pub.body.id}`)
      .set('Cookie', session.cookie)
      .send({ status: 'PROCESSED' })
      .expect(200);
    const list = await request(app).get('/api/publications?status=PENDING').set('Cookie', session.cookie).expect(200);
    assert.equal(list.body.items.length, 0);
  });

  it('rejects intimação for process of another org', async () => {
    const a = await helper.registerAndLogin();
    const b = await helper.registerAndLogin();
    const proc = await createCase(a);
    const res = await request(app)
      .post('/api/publications')
      .set('Cookie', b.cookie)
      .send({ processId: proc.id, content: 'Não deveria' });
    assert.equal(res.status, 400);
  });
});