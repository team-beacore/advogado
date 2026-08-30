import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb, createSecondUserInOrg } from './helpers';

describe('Permissões granulares por processo', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  async function createCase(session: { cookie: string }) {
    const res = await request(app)
      .post('/api/processes')
      .set('Cookie', session.cookie)
      .send({ title: 'Proc Perm', processNumber: '1010-10.2024.8.01.0001' })
      .expect(201);
    return res.body;
  }

  it('admin (criador) pode ver o processo via detalhe', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    const detail = await request(app).get(`/api/processes/${proc.id}`).set('Cookie', session.cookie).expect(200);
    assert.equal(detail.body.id, proc.id);
  });

  it('membro sem permissão de view não pode ver o processo', async () => {
    const admin = await helper.registerAndLogin();
    const member = await createSecondUserInOrg(app, admin, { role: 'ASSISTANT' });
    const proc = await createCase(admin);

    // member não é membro do processo (não adicionado explicitamente)
    const res = await request(app).get(`/api/processes/${proc.id}`).set('Cookie', member.cookie).expect(403);
    assert.equal(res.body.code, 'FORBIDDEN');
  });

  it('membro adicionado ao processo com can_view=true pode ver', async () => {
    const admin = await helper.registerAndLogin();
    const member = await createSecondUserInOrg(app, admin, { role: 'LAWYER' });
    const proc = await createCase(admin);

    await request(app)
      .post(`/api/processes/${proc.id}/members`)
      .set('Cookie', admin.cookie)
      .send({ userId: member.userId, role: 'LAWYER' })
      .expect(201);

    const detail = await request(app).get(`/api/processes/${proc.id}`).set('Cookie', member.cookie).expect(200);
    assert.equal(detail.body.id, proc.id);
  });

  it('membro sem can_edit não pode editar o processo', async () => {
    const admin = await helper.registerAndLogin();
    const member = await createSecondUserInOrg(app, admin, { role: 'ASSISTANT' });
    const proc = await createCase(admin);

    await request(app)
      .post(`/api/processes/${proc.id}/members`)
      .set('Cookie', admin.cookie)
      .send({ userId: member.userId, role: 'ASSISTANT' })
      .expect(201);

    const res = await request(app)
      .patch(`/api/processes/${proc.id}`)
      .set('Cookie', member.cookie)
      .send({ status: 'SUSPENDED' })
      .expect(403);
    assert.equal(res.body.code, 'FORBIDDEN');
  });

  it('membro com can_edit pode editar o processo', async () => {
    const admin = await helper.registerAndLogin();
    const member = await createSecondUserInOrg(app, admin, { role: 'LAWYER' });
    const proc = await createCase(admin);

    await request(app)
      .post(`/api/processes/${proc.id}/members`)
      .set('Cookie', admin.cookie)
      .send({ userId: member.userId, role: 'LAWYER' })
      .expect(201);

    await request(app)
      .patch(`/api/processes/${proc.id}`)
      .set('Cookie', member.cookie)
      .send({ status: 'SUSPENDED' })
      .expect(200);
  });

  it('admin pode gerenciar membros, membro comum não', async () => {
    const admin = await helper.registerAndLogin();
    const member = await createSecondUserInOrg(app, admin, { role: 'LAWYER' });
    const proc = await createCase(admin);

    await request(app)
      .post(`/api/processes/${proc.id}/members`)
      .set('Cookie', admin.cookie)
      .send({ userId: member.userId, role: 'LAWYER' })
      .expect(201);

    // member tenta adicionar outro membro
    const third = await createSecondUserInOrg(app, admin, { role: 'LAWYER', email: 'third@test.local' });
    const res = await request(app)
      .post(`/api/processes/${proc.id}/members`)
      .set('Cookie', member.cookie)
      .send({ userId: third.userId, role: 'LAWYER' })
      .expect(403);
    assert.equal(res.body.code, 'FORBIDDEN');
  });
});