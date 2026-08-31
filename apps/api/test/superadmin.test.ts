import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, createSuperAdmin, makeApp, resetDb, uniqueEmail } from './helpers';

describe('SUPER ADMIN — identidade técnica separada', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  it('1. SUPER ADMIN não pertence à organização (não há member vinculado)', async () => {
    const sa = await createSuperAdmin(app);
    const pool = (await import('../src/db/client')).getPool();
    const res = await pool.query('SELECT count(*)::int AS n FROM organization_members WHERE user_id = $1', [sa.userId]);
    assert.equal(res.rows[0].n, 0);
  });

  it('2. SUPER ADMIN não aparece na equipe de nenhuma organização', async () => {
    const sa = await createSuperAdmin(app);
    const client = await helper.registerAndLogin();
    const members = await request(app).get('/api/organizations/members').set('Cookie', client.cookie).expect(200);
    assert.ok(!members.body.some((m: { email: string }) => m.email === sa.email));
  });

  it('3. SUPER ADMIN não possui acesso jurídico normal (sem organização)', async () => {
    const sa = await createSuperAdmin(app);
    // rotas de negócio exigem organização → 403
    await request(app).get('/api/processes').set('Cookie', sa.cookie).expect(403);
    await request(app).get('/api/clients').set('Cookie', sa.cookie).expect(403);
    await request(app).get('/api/finance/summary').set('Cookie', sa.cookie).expect(403);
  });

  it('4. SUPER ADMIN pode executar funções técnicas permitidas', async () => {
    const sa = await createSuperAdmin(app);
    const status = await request(app).get('/api/superadmin/status').set('Cookie', sa.cookie).expect(200);
    assert.equal(status.body.ok, true);
    assert.equal(status.body.counts.organizations, 0);
  });

  it('5. primeiro usuário (admin) é ADMIN e entra como membro da org', async () => {
    const session = await helper.registerAndLogin();
    assert.equal(session.role, 'ADMIN');
    const pool = (await import('../src/db/client')).getPool();
    const res = await pool.query('SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2', [session.orgId, session.userId]);
    assert.equal(res.rows[0]?.role, 'ADMIN');
  });

  it('6. ADMIN pode ser ADMIN + LAWYER (possui permissões de LAWYER)', async () => {
    const session = await helper.registerAndLogin();
    const proc = await request(app).post('/api/processes').set('Cookie', session.cookie).send({ title: 'Proc Admin' }).expect(201);
    assert.ok(proc.body.id);
  });

  it('7. advogado solo funciona sem equipe', async () => {
    const session = await helper.registerAndLogin();
    const members = await request(app).get('/api/organizations/members').set('Cookie', session.cookie).expect(200);
    assert.equal(members.body.length, 1);
    const client = await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Solo', email: 'solo2@test.com' }).expect(201);
    assert.ok(client.body.id);
  });

  it('8. ADMIN pode administrar a organização (convidar membro)', async () => {
    const admin = await helper.registerAndLogin();
    const member = await helper.registerAndLogin();
    await request(app).post('/api/organizations/members').set('Cookie', admin.cookie).send({ email: member.email, role: 'LAWYER' }).expect(201);
    const members = await request(app).get('/api/organizations/members').set('Cookie', admin.cookie).expect(200);
    assert.equal(members.body.length, 2);
  });

  it('bootstrap cria organização e primeiro admin sem vincular SUPER ADMIN', async () => {
    const sa = await createSuperAdmin(app);
    const adminEmail = uniqueEmail('clientadmin');
    const res = await request(app)
      .post('/api/superadmin/bootstrap')
      .set('Cookie', sa.cookie)
      .send({ orgName: 'Escritório Cliente', adminEmail, adminPassword: 'test1234', adminName: 'Cliente Admin' })
      .expect(201);
    assert.ok(res.body.organization.id);
    assert.equal(res.body.admin.email, adminEmail);

    // o admin criado pertence à organização
    const pool = (await import('../src/db/client')).getPool();
    const memberRes = await pool.query(
      'SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2',
      [res.body.organization.id, res.body.admin.id],
    );
    assert.equal(memberRes.rows[0]?.role, 'ADMIN');

    // o SUPER ADMIN NÃO virou membro da organização
    const saMember = await pool.query(
      'SELECT count(*)::int AS n FROM organization_members WHERE user_id = $1',
      [sa.userId],
    );
    assert.equal(saMember.rows[0].n, 0);

    // auditoria registrada (consulta direta, já que SUPER ADMIN não tem org para acessar audit route)
    const auditRes = await pool.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'ORGANIZATION_BOOTSTRAPPED'",
    );
    assert.ok(auditRes.rows[0].n >= 1);
  });

  it('bootstrap não permite criar SUPER ADMIN como admin da org', async () => {
    const sa = await createSuperAdmin(app);
    await request(app)
      .post('/api/superadmin/bootstrap')
      .set('Cookie', sa.cookie)
      .send({ orgName: 'Org X', adminEmail: sa.email, adminPassword: 'test1234', adminName: 'X' })
      .expect(400);
  });

  // --- Testes específicos de login e sessão (itens 1-18) ---

  it('login devolve isSuperAdmin=true e organizationId=null para SUPER ADMIN', async () => {
    const sa = await createSuperAdmin(app);
    const loginRes = await request(app).post('/api/auth/login').send({ email: sa.email, password: 'test1234' }).expect(200);
    assert.equal(loginRes.body.user.isSuperAdmin, true);
    assert.equal(loginRes.body.organizationId, null);
    // /me também confirma
    const me = await request(app).get('/api/auth/me').set('Cookie', sa.cookie).expect(200);
    assert.equal(me.body.user.isSuperAdmin, true);
    assert.equal(me.body.user.organizationId, null);
  });

  it('SUPER ADMIN não seleciona automaticamente a primeira organização', async () => {
    const sa = await createSuperAdmin(app);
    const lp = await request(app).post('/api/auth/switch-org').set('Cookie', sa.cookie).send({ organizationId: '00000000-0000-0000-0000-000000000000' });
    assert.ok([403, 400].includes(lp.status));
  });

  it('bootstrap-created admin consegue login e tem organizationId', async () => {
    const sa = await createSuperAdmin(app);
    const adminEmail = uniqueEmail('bootadmin');
    await request(app)
      .post('/api/superadmin/bootstrap')
      .set('Cookie', sa.cookie)
      .send({ orgName: 'Bootstrap Test', adminEmail, adminPassword: 'test1234', adminName: 'Boot Admin' })
      .expect(201);
    // login do admin criado
    const loginRes = await request(app).post('/api/auth/login').send({ email: adminEmail, password: 'test1234' }).expect(200);
    assert.equal(loginRes.body.user.isSuperAdmin, false);
    assert.ok(loginRes.body.organizationId); // deve ter org
    // dashboard jurídico acessível
    const me = await request(app).get('/api/auth/me').set('Cookie', loginRes.headers['set-cookie']?.[0]?.split(';')[0]!).expect(200);
    assert.equal(me.body.user.isSuperAdmin, false);
    assert.ok(me.body.user.organizationId);
  });

  it('logout SUPER ADMIN → login ADMIN não herda organizationId', async () => {
    const sa = await createSuperAdmin(app);
    // SA faz login
    const saLogin = await request(app).post('/api/auth/login').send({ email: sa.email, password: 'test1234' }).expect(200);
    assert.equal(saLogin.body.organizationId, null);
    // SA faz logout
    const saCookie = saLogin.headers['set-cookie']?.[0]?.split(';')[0]!;
    await request(app).post('/api/auth/logout').set('Cookie', saCookie).expect(200);
    // admin normal faz login
    const admin = await helper.registerAndLogin();
    const adminLogin = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'test1234' }).expect(200);
    assert.ok(adminLogin.body.organizationId); // admin tem org
  });

  it('SUPER ADMIN não consegue acessar rotas jurídicas (requireOrg)', async () => {
    const sa = await createSuperAdmin(app);
    await request(app).get('/api/processes').set('Cookie', sa.cookie).expect(403);
    await request(app).get('/api/clients').set('Cookie', sa.cookie).expect(403);
    await request(app).get('/api/documents').set('Cookie', sa.cookie).expect(403);
    await request(app).get('/api/tasks').set('Cookie', sa.cookie).expect(403);
    await request(app).get('/api/publications').set('Cookie', sa.cookie).expect(403);
    await request(app).get('/api/ai/status').set('Cookie', sa.cookie).expect(403);
    await request(app).get('/api/finance/summary').set('Cookie', sa.cookie).expect(403);
  });

  it('usuário normal sem organização continua no onboarding', async () => {
    const email = uniqueEmail();
    const password = 'test1234';
    await request(app).post('/api/auth/register').send({ name: 'New User', email, password }).expect(201);
    const loginRes = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
    // sem organização → organizationId null
    assert.equal(loginRes.body.organizationId, null);
    assert.equal(loginRes.body.user.isSuperAdmin, false);
  });
});