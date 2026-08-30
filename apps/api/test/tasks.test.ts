import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb } from './helpers';

describe('Tasks', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  it('creates a task', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app)
      .post('/api/tasks')
      .set('Cookie', session.cookie)
      .send({ title: 'Elaborar contestação', priority: 'HIGH', dueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);
    assert.equal(res.body.title, 'Elaborar contestação');
    assert.equal(res.body.priority, 'HIGH');
    assert.equal(res.body.status, 'TODO');
  });

  it('creates task linked to a process', async () => {
    const session = await helper.registerAndLogin();
    const proc = await request(app)
      .post('/api/processes')
      .set('Cookie', session.cookie)
      .send({ title: 'Proc', processNumber: '2222-22.2024.8.01.0001' })
      .expect(201);
    const task = await request(app)
      .post('/api/tasks')
      .set('Cookie', session.cookie)
      .send({ processId: proc.body.id, title: 'Analisar sentença', dueDate: new Date().toISOString() })
      .expect(201);
    assert.equal(task.body.process_id, proc.body.id);
  });

  it('completes a task', async () => {
    const session = await helper.registerAndLogin();
    const task = await request(app)
      .post('/api/tasks')
      .set('Cookie', session.cookie)
      .send({ title: 'Fazer algo' })
      .expect(201);
    await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Cookie', session.cookie)
      .send({ status: 'DONE' })
      .expect(200);
    const list = await request(app).get('/api/tasks?view=done').set('Cookie', session.cookie).expect(200);
    assert.equal(list.body.items.length, 1);
  });

  it('shows task summary counts', async () => {
    const session = await helper.registerAndLogin();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const ago = new Date(startOfDay.getTime() - 12 * 3600000).toISOString();   // ontem ao meio-dia → sempre overdue
    const todayNoon = new Date(startOfDay.getTime() + 12 * 3600000).toISOString(); // hoje ao meio-dia → sempre em "today"
    await request(app).post('/api/tasks').set('Cookie', session.cookie).send({ title: 'Atrasada', dueDate: ago }).expect(201);
    await request(app).post('/api/tasks').set('Cookie', session.cookie).send({ title: 'Hoje', dueDate: todayNoon }).expect(201);
    await request(app).post('/api/tasks').set('Cookie', session.cookie).send({ title: 'Futura' }).expect(201);

    const summary = await request(app).get('/api/tasks/summary').set('Cookie', session.cookie).expect(200);
    // "Atrasada" (ontem) sempre conta como overdue; "Hoje" (meio-dia) também entra em overdue se a hora atual já passou dele
    const todayPast = now >= new Date(todayNoon);
    assert.equal(summary.body.overdue, todayPast ? 2 : 1);
    assert.equal(summary.body.today, 1);
    // "Futura" (sem data) sempre conta como upcoming; "Hoje" também enquanto o meio-dia não passou
    assert.equal(summary.body.upcoming, todayPast ? 1 : 2);
    assert.equal(summary.body.done, 0);
  });
});