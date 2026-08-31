import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb } from './helpers';

describe('Audit logs', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  it('logs client creation', async () => {
    const session = await helper.registerAndLogin();
    await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Auditado' }).expect(201);
    await new Promise((r) => setTimeout(r, 50));
    const logs = await request(app).get('/api/audit').set('Cookie', session.cookie).expect(200);
    assert.ok(logs.body.items.some((l: { action: string }) => l.action === 'CLIENT_CREATED'));
    assert.ok(logs.body.items.some((l: { entity: string }) => l.entity === 'client'));
  });

  it('logs process creation', async () => {
    const session = await helper.registerAndLogin();
    await request(app)
      .post('/api/processes')
      .set('Cookie', session.cookie)
      .send({ title: 'Proc Audit', processNumber: '4444-44.2024.8.01.0001' })
      .expect(201);
    const logs = await request(app).get('/api/audit?entity=case').set('Cookie', session.cookie).expect(200);
    assert.ok(logs.body.items.some((l: { action: string }) => l.action === 'CASE_CREATED'));
  });

  it('logs document upload and download', async () => {
    const session = await helper.registerAndLogin();
    const proc = await request(app)
      .post('/api/processes')
      .set('Cookie', session.cookie)
      .send({ title: 'Proc', processNumber: '5555-55.2024.8.01.0001' })
      .expect(201);
    const upload = await request(app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .attach('file', Buffer.from('pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' })
      .field('processId', proc.body.id)
      .expect(201);
    await request(app).get(`/api/documents/${upload.body.id}/download`).set('Cookie', session.cookie).expect(200);
    await new Promise((r) => setTimeout(r, 50));

    const logs = await request(app).get('/api/audit?entity=document').set('Cookie', session.cookie).expect(200);
    const actions = logs.body.items.map((l: { action: string }) => l.action);
    assert.ok(actions.includes('DOCUMENT_UPLOADED'));
    assert.ok(actions.includes('DOCUMENT_VIEWED'));
  });

  it('logs task updates', async () => {
    const session = await helper.registerAndLogin();
    const task = await request(app).post('/api/tasks').set('Cookie', session.cookie).send({ title: 'Tarefa' }).expect(201);
    await request(app).patch(`/api/tasks/${task.body.id}`).set('Cookie', session.cookie).send({ status: 'DONE' }).expect(200);
    const logs = await request(app).get('/api/audit?entity=task').set('Cookie', session.cookie).expect(200);
    assert.ok(logs.body.items.some((l: { action: string }) => l.action === 'TASK_UPDATED'));
  });

  it('does not leak audit logs across orgs', async () => {
    const a = await helper.registerAndLogin();
    const b = await helper.registerAndLogin();
    await request(app).post('/api/clients').set('Cookie', a.cookie).send({ name: 'Segredo A' }).expect(201);
    const logsB = await request(app).get('/api/audit?entity=client').set('Cookie', b.cookie).expect(200);
    assert.equal(logsB.body.items.length, 0);
    assert.equal(logsB.body.total, 0);
  });
});