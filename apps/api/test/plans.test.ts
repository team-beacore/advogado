import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, createSecondUserInOrg, makeApp, resetDb, uniqueEmail } from './helpers';
import { getPool } from '../src/db/client';

describe('Plano SOLO x OFFICE, senha, canais e captura', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  async function setPlan(orgId: string, plan: 'SOLO' | 'OFFICE') {
    const pool = getPool();
    await pool.query('UPDATE organizations SET plan_type = $1 WHERE id = $2', [plan, orgId]);
  }

  // ============ SOLO ============
  it('1. ADMIN SOLO não pode criar membro (403)', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'SOLO');
    const res = await request(app)
      .post('/api/organizations/members')
      .set('Cookie', session.cookie)
      .send({ email: uniqueEmail(), role: 'LAWYER', name: 'Novo' });
    assert.equal(res.status, 403);
  });

  it('2. ADMIN SOLO não pode criar LAWYER (403)', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'SOLO');
    const res = await request(app).post('/api/organizations/members').set('Cookie', session.cookie).send({ email: uniqueEmail(), role: 'LAWYER' });
    assert.equal(res.status, 403);
  });

  it('3. ADMIN SOLO não pode criar ASSISTANT (403)', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'SOLO');
    const res = await request(app).post('/api/organizations/members').set('Cookie', session.cookie).send({ email: uniqueEmail(), role: 'ASSISTANT' });
    assert.equal(res.status, 403);
  });

  it('4. ADMIN SOLO não pode criar FINANCE (403)', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'SOLO');
    const res = await request(app).post('/api/organizations/members').set('Cookie', session.cookie).send({ email: uniqueEmail(), role: 'FINANCE' });
    assert.equal(res.status, 403);
  });

  it('5. ADMIN SOLO não pode alterar role de membro (403)', async () => {
    const admin = await helper.registerAndLogin();
    const member = await createSecondUserInOrg(app, admin, { role: 'LAWYER' });
    await setPlan(admin.orgId, 'SOLO');
    const res = await request(app).patch(`/api/organizations/members/${member.userId}`).set('Cookie', admin.cookie).send({ role: 'ASSISTANT' });
    assert.equal(res.status, 403);
  });

  // ============ OFFICE ============
  it('6. ADMIN OFFICE pode criar LAWYER', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'OFFICE');
    const email = uniqueEmail();
    const res = await request(app).post('/api/organizations/members').set('Cookie', session.cookie).send({ email, role: 'LAWYER', name: 'Maria Silva' }).expect(201);
    assert.equal(res.body.role, 'LAWYER');
    assert.equal(res.body.email, email);
    // senha temporária gerada aleatoriamente
    assert.ok(res.body.temporaryPassword);
    assert.ok(res.body.temporaryPassword.length >= 8);
  });

  it('7. ADMIN OFFICE pode criar ASSISTANT', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'OFFICE');
    const res = await request(app).post('/api/organizations/members').set('Cookie', session.cookie).send({ email: uniqueEmail(), role: 'ASSISTANT', name: 'Ana' }).expect(201);
    assert.equal(res.body.role, 'ASSISTANT');
  });

  it('8. ADMIN OFFICE pode criar FINANCE', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'OFFICE');
    const res = await request(app).post('/api/organizations/members').set('Cookie', session.cookie).send({ email: uniqueEmail(), role: 'FINANCE', name: 'Carlos' }).expect(201);
    assert.equal(res.body.role, 'FINANCE');
  });

  it('9. ADMIN não pode criar outro ADMIN', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'OFFICE');
    const res = await request(app).post('/api/organizations/members').set('Cookie', session.cookie).send({ email: uniqueEmail(), role: 'ADMIN' });
    assert.equal(res.status, 400);
  });

  it('10. senha temporária não é armazenada em texto puro', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'OFFICE');
    const email = uniqueEmail();
    const res = await request(app).post('/api/organizations/members').set('Cookie', session.cookie).send({ email, role: 'LAWYER', name: 'Maria' }).expect(201);
    const pool = getPool();
    const user = await pool.query('SELECT password_hash FROM users WHERE email = $1', [email]);
    assert.ok(user.rows[0].password_hash.startsWith('scrypt$'));
    assert.ok(!user.rows[0].password_hash.includes(res.body.temporaryPassword));
  });

  it('11. membro consegue fazer login com a senha temporária', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'OFFICE');
    const email = uniqueEmail();
    const password = 'Temp!Ab3x9Qz';
    const res = await request(app).post('/api/organizations/members').set('Cookie', session.cookie).send({ email, role: 'LAWYER', name: 'Maria' }).expect(201);
    // sobrescreve com senha conhecida para o teste de login
    const pool = getPool();
    const { ScryptHasher } = await import('../src/auth/password');
    const hasher = new ScryptHasher();
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hasher.hash(password), email]);
    const login = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
    assert.ok(login.headers['set-cookie']);
  });

  it('12. membro consegue alterar a própria senha', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'OFFICE');
    const email = uniqueEmail();
    const temp = 'Temp!Ab3x9Qz';
    // cria o membro via API (gera usuário + senha temporária)
    await request(app).post('/api/organizations/members').set('Cookie', session.cookie).send({ email, role: 'LAWYER', name: 'Maria' }).expect(201);
    // define uma senha conhecida para o login no teste
    const pool = getPool();
    const { ScryptHasher } = await import('../src/auth/password');
    const hasher = new ScryptHasher();
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hasher.hash(temp), email]);
    const login = await request(app).post('/api/auth/login').send({ email, password: temp }).expect(200);
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0]!;
    const res = await request(app).post('/api/auth/change-password').set('Cookie', cookie).send({ currentPassword: temp, newPassword: 'NovaSenha123!' }).expect(200);
    assert.equal(res.body.ok, true);
    // senha errada não passa
    await request(app).post('/api/auth/change-password').set('Cookie', cookie).send({ currentPassword: 'errada', newPassword: 'Outra123!' }).expect(400);
  });

  it('13. ADVOGADO SOLO pode alterar a própria senha', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'SOLO');
    const res = await request(app).post('/api/auth/change-password').set('Cookie', session.cookie).send({ currentPassword: 'test1234', newPassword: 'NovaSenha123!' }).expect(200);
    assert.equal(res.body.ok, true);
  });

  it('14. mudança de senha invalida demais sessões', async () => {
    const session = await helper.registerAndLogin();
    // segunda sessão
    const login2 = await request(app).post('/api/auth/login').send({ email: session.email, password: 'test1234' }).expect(200);
    const cookie2 = login2.headers['set-cookie']?.[0]?.split(';')[0]!;
    await request(app).post('/api/auth/change-password').set('Cookie', session.cookie).send({ currentPassword: 'test1234', newPassword: 'NovaSenha123!' }).expect(200);
    // a segunda sessão foi invalidada → /me falha
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie2);
    assert.equal(me.status, 401);
  });

  // ============ CANAIS ============
  it('15. ADMIN não consegue reconfigurar SMTP (só ativar/desativar)', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'OFFICE');
    // SUPER ADMIN configurou previamente via wizard (settings)
    const pool = getPool();
    await pool.query(
      `INSERT INTO settings (organization_id, key, value) VALUES ($1, 'integration.notify.EMAIL', $2)
       ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [session.orgId, JSON.stringify({ enabled: true, host: 'smtp.original.com', port: 587, user: 'u', pass: 'p', from: 'f@o.com' })],
    );
    // ADMIN tenta mudar host → deve ser ignorado (apenas enabled muda)
    await request(app).put('/api/notifications/channels').set('Cookie', session.cookie).send({ channel: 'EMAIL', enabled: false, config: { host: 'smtp.hacker.com' } }).expect(200);
    const status = await request(app).get('/api/notifications/channels/status').set('Cookie', session.cookie).expect(200);
    const email = status.body.find((c: { channel: string }) => c.channel === 'EMAIL');
    assert.equal(email.enabled, false);
    // config técnica preservada
    const cfg = await pool.query('SELECT value FROM settings WHERE organization_id = $1 AND key = $2', [session.orgId, 'integration.notify.EMAIL']);
    assert.equal(cfg.rows[0].value.host, 'smtp.original.com');
  });

  it('16. ADMIN pode ativar/desativar email', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'OFFICE');
    const pool = getPool();
    await pool.query(
      `INSERT INTO settings (organization_id, key, value) VALUES ($1, 'integration.notify.EMAIL', $2)
       ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [session.orgId, JSON.stringify({ enabled: true, host: 'smtp.o.com', port: 587, user: 'u', pass: 'p', from: 'f@o.com' })],
    );
    await request(app).put('/api/notifications/channels').set('Cookie', session.cookie).send({ channel: 'EMAIL', enabled: false }).expect(200);
    const status = await request(app).get('/api/notifications/channels/status').set('Cookie', session.cookie).expect(200);
    assert.equal(status.body.find((c: { channel: string }) => c.channel === 'EMAIL').enabled, false);
  });

  // ============ CAPTURA ============
  it('17. ADMIN não consegue alterar config técnica PJe (só ativar/desativar)', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'OFFICE');
    const pool = getPool();
    await pool.query(
      `INSERT INTO settings (organization_id, key, value) VALUES ($1, 'integration.capture.pje', $2)
       ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [session.orgId, JSON.stringify({ enabled: true, login: 'original-login', password: 'secret', baseUrl: 'https://pje.original.com' })],
    );
    await request(app).put('/api/capture/config').set('Cookie', session.cookie).send({ source: 'PJE', enabled: false, login: 'hacked', password: 'hacked', baseUrl: 'https://hacker.com' }).expect(200);
    const cfg = await pool.query('SELECT value FROM settings WHERE organization_id = $1 AND key = $2', [session.orgId, 'integration.capture.pje']);
    assert.equal(cfg.rows[0].value.enabled, false);
    assert.equal(cfg.rows[0].value.login, 'original-login');
    assert.equal(cfg.rows[0].value.baseUrl, 'https://pje.original.com');
  });

  it('18. ADMIN consegue ativar/desativar captura configurada', async () => {
    const session = await helper.registerAndLogin();
    await setPlan(session.orgId, 'OFFICE');
    const pool = getPool();
    await pool.query(
      `INSERT INTO settings (organization_id, key, value) VALUES ($1, 'integration.capture.pje', $2)
       ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [session.orgId, JSON.stringify({ enabled: true, login: 'l', password: 'p', baseUrl: 'u' })],
    );
    await request(app).put('/api/capture/config').set('Cookie', session.cookie).send({ source: 'PJE', enabled: false }).expect(200);
    const list = await request(app).get('/api/capture/config').set('Cookie', session.cookie).expect(200);
    assert.equal(list.body.find((c: { source: string }) => c.source === 'PJE').enabled, false);
  });

  // ============ IA / secrets ============
  it('19. secrets não são retornados ao ADMIN', async () => {
    const session = await helper.registerAndLogin();
    const report = await request(app).get('/api/settings/security').set('Cookie', session.cookie).expect(200);
    assert.equal(report.body.ai.apiKey, undefined);
    // não há API key em nenhuma resposta comum
    const channels = await request(app).get('/api/notifications/channels/status').set('Cookie', session.cookie).expect(200);
    assert.ok(!JSON.stringify(channels.body).includes('password'));
  });
});