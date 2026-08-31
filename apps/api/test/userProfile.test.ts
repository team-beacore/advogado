import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb, uniqueEmail } from './helpers';

describe('Usuário: telefone', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  it('registro aceita telefone opcional e o retorna', async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Com Telefone', email, password: 'test1234', phone: '5521999991111' })
      .expect(201);
    assert.equal(res.body.user.phone, '5521999991111');
  });

  it('telefone é opcional no registro', async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Sem Telefone', email, password: 'test1234' })
      .expect(201);
    assert.equal(res.body.user.phone, null);
  });

  it('usuário pode atualizar o telefone', async () => {
    const session = await helper.registerAndLogin();
    await request(app).patch('/api/auth/me').set('Cookie', session.cookie).send({ phone: '5521888889999' }).expect(200);
    const me = await request(app).get('/api/auth/me').set('Cookie', session.cookie).expect(200);
    assert.equal(me.body.user.phone, '5521888889999');
  });

  it('perfil pode ser consultado via /api/auth/me com phone', async () => {
    const email = uniqueEmail();
    const password = 'test1234';
    await request(app).post('/api/auth/register').send({ name: 'Perfil', email, password, phone: '5521999988888' }).expect(201);
    const login = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0]!;
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    assert.equal(me.body.user.phone, '5521999988888');
  });
});
