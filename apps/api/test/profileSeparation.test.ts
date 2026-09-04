import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, createSecondUserInOrg, createSuperAdmin, makeApp, resetDb, uniqueEmail } from './helpers';
import { getPool } from '../src/db/client';

describe('SEPARAÇÃO PERFIL × CONFIGURAÇÕES', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  it('dados pessoais (PATCH /api/auth/me) NÃO alteram a identidade profissional', async () => {
    const session = await helper.registerAndLogin();
    await request(app)
      .put('/api/professional-identity/me')
      .set('Cookie', session.cookie)
      .send({ professionalName: 'Dr. Original', oabNumber: '111', oabState: 'RJ' })
      .expect(201);

    // altera apenas nome/telefone no perfil
    await request(app).patch('/api/auth/me').set('Cookie', session.cookie).send({ name: 'Novo Nome', phone: '5521999990000' }).expect(200);

    // identidade profissional permanece intacta
    const me = await request(app).get('/api/professional-identity/me').set('Cookie', session.cookie).expect(200);
    assert.equal(me.body.identity.professional_name, 'Dr. Original');
    assert.equal(me.body.identity.oab_number, '111');
    assert.equal(me.body.identity.oab_state, 'RJ');

    // e os dados pessoais foram atualizados
    const profile = await request(app).get('/api/auth/me').set('Cookie', session.cookie).expect(200);
    assert.equal(profile.body.user.name, 'Novo Nome');
    assert.equal(profile.body.user.phone, '5521999990000');
  });

  it('OFFICE: cada advogado possui sua própria identidade profissional (OAB/UF)', async () => {
    const admin = await helper.registerAndLogin();
    const lawyerA = await createSecondUserInOrg(app, admin, { role: 'LAWYER' });
    const lawyerB = await createSecondUserInOrg(app, admin, { role: 'LAWYER' });

    await request(app)
      .put('/api/professional-identity/me')
      .set('Cookie', lawyerA.cookie)
      .send({ professionalName: 'Dr. João', oabNumber: '12345', oabState: 'SP' })
      .expect(201);
    await request(app)
      .put('/api/professional-identity/me')
      .set('Cookie', lawyerB.cookie)
      .send({ professionalName: 'Dra. Maria', oabNumber: '67890', oabState: 'SP' })
      .expect(201);

    // cada um lê a própria identidade
    const a = await request(app).get('/api/professional-identity/me').set('Cookie', lawyerA.cookie).expect(200);
    const b = await request(app).get('/api/professional-identity/me').set('Cookie', lawyerB.cookie).expect(200);
    assert.equal(a.body.identity.oab_number, '12345');
    assert.equal(a.body.identity.user_id, lawyerA.userId);
    assert.equal(b.body.identity.oab_number, '67890');
    assert.equal(b.body.identity.user_id, lawyerB.userId);

    // não existe uma única OAB global da instalação
    const pool = getPool();
    const orgSettings = await pool.query('SELECT key, value FROM settings WHERE organization_id = $1', [admin.orgId]);
    for (const row of orgSettings.rows) {
      const value = JSON.stringify(row.value);
      assert.ok(!value.includes('oab') && !value.includes('uf'), `settings ${row.key} não deve conter OAB/UF global`);
    }
  });

  it('ASSISTANT e FINANCE não possuem acesso administrativo por terem Perfil (settings.manage continua restrito)', async () => {
    const admin = await helper.registerAndLogin();
    const assistant = await createSecondUserInOrg(app, admin, { role: 'ASSISTANT' });

    // o próprio perfil é acessível
    const me = await request(app).get('/api/auth/me').set('Cookie', assistant.cookie).expect(200);
    assert.ok(me.body.user.id);

    // identidade profissional própria é acessível (sem role restritivo)
    await request(app)
      .put('/api/professional-identity/me')
      .set('Cookie', assistant.cookie)
      .send({ professionalName: 'Assistente Carlos', oabNumber: '999', oabState: 'RJ' })
      .expect(201);

    // mas configurações administrativas seguem bloqueadas por RBAC
    await request(app).get('/api/capture/config').set('Cookie', assistant.cookie).expect(403);
    await request(app).put('/api/notifications/channels').set('Cookie', assistant.cookie).send({ channel: 'EMAIL', enabled: true }).expect(403);
  });

  it('SUPER ADMIN não acessa perfil de organização (permanece fora da camada jurídica)', async () => {
    const sa = await createSuperAdmin(app);
    await request(app).get('/api/professional-identity/me').set('Cookie', sa.cookie).expect(403);
  });
});
