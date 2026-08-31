import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, createSecondUserInOrg, makeApp, resetDb } from './helpers';
import { setNotificationChannelsForTests } from '../src/notify/registry';
import type { NotificationChannel, ChannelMessage, ChannelResult } from '../src/notify/types';

class FakeEmailChannel implements NotificationChannel {
  readonly name = 'EMAIL' as const;
  lastMessage: ChannelMessage | null = null;
  isConfigured(_config: Record<string, unknown> | null): boolean { return true; }
  async send(msg: ChannelMessage, _config: Record<string, unknown>): Promise<ChannelResult> {
    this.lastMessage = msg;
    return { channel: 'EMAIL', status: 'SENT', externalReference: 'fake-email-id' };
  }
}

class FakeFailingEmailChannel implements NotificationChannel {
  readonly name = 'EMAIL' as const;
  isConfigured(_config: Record<string, unknown> | null): boolean { return true; }
  async send(_msg: ChannelMessage, _config: Record<string, unknown>): Promise<ChannelResult> {
    return { channel: 'EMAIL', status: 'FAILED', error: 'Simulated SMTP failure' };
  }
}

describe('Notificações: destinatário baseado no responsável', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);
  const emailChannel = new FakeEmailChannel();

  before(async () => { await resetDb(); setNotificationChannelsForTests([emailChannel]); });
  after(async () => { setNotificationChannelsForTests(null); const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); emailChannel.lastMessage = null; });

  async function configureChannels(session: { cookie: string }) {
    await request(app).put('/api/notifications/channels').set('Cookie', session.cookie).send({
      channel: 'EMAIL', enabled: true, config: { host: 'smtp.test.com', port: 587, user: 'u', pass: 'p', from: 'test@test.com' },
    }).expect(200);
  }

  async function createCase(session: { cookie: string }, responsibleId?: string) {
    const body: Record<string, unknown> = { title: 'Proc Resp', processNumber: `9999-99.2024.8.01.${Math.floor(Math.random() * 9999)}` };
    if (responsibleId) body.responsibleId = responsibleId;
    const res = await request(app).post('/api/processes').set('Cookie', session.cookie).send(body).expect(201);
    return res.body;
  }

  function setPrefs(cookie: string, prefs: Record<string, boolean>) {
    return request(app).put('/api/notifications/preferences').set('Cookie', cookie).send(prefs).expect(200);
  }

  it('intimação vai para o responsável, não para quem registrou (assistente)', async () => {
    const admin = await helper.registerAndLogin();
    await configureChannels(admin);
    const responsible = admin;
    const assistant = await createSecondUserInOrg(app, admin, { role: 'ASSISTANT' });
    const proc = await createCase(admin, responsible.userId);
    // assistente precisa de permissão de edição no processo para registrar a intimação
    await request(app)
      .post(`/api/processes/${proc.id}/members`)
      .set('Cookie', admin.cookie)
      .send({ userId: assistant.userId, role: 'LAWYER' })
      .expect(201);

    await request(app)
      .post('/api/publications')
      .set('Cookie', assistant.cookie)
      .send({ processId: proc.id, content: 'Intimação registrada pelo assistente', possibleDueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);

    assert.equal(emailChannel.lastMessage?.to, responsible.email);
    const deliveries = await request(app).get('/api/notifications/deliveries').set('Cookie', admin.cookie).expect(200);
    const emailDeliveries = deliveries.body.items.filter((d: { channel: string }) => d.channel === 'EMAIL');
    assert.ok(emailDeliveries.length >= 1);
    assert.equal(emailDeliveries[0].recipient, responsible.email);
    assert.notEqual(emailDeliveries[0].recipient, assistant.email);
  });

  it('advogado solo recebe a notificação ao registrar a própria intimação', async () => {
    const session = await helper.registerAndLogin();
    await configureChannels(session);
    const proc = await createCase(session);

    await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.id, content: 'Intimação solo', possibleDueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);

    assert.equal(emailChannel.lastMessage?.to, session.email);
  });

  it('preferência desativada impede o envio', async () => {
    const session = await helper.registerAndLogin();
    await configureChannels(session);
    await setPrefs(session.cookie, { emailEnabled: false });
    const proc = await createCase(session);

    await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.id, content: 'Sem envio', possibleDueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);

    assert.equal(emailChannel.lastMessage, null);
  });

  it('preferência ativada envia pelo canal de e-mail', async () => {
    const session = await helper.registerAndLogin();
    await configureChannels(session);
    await setPrefs(session.cookie, { emailEnabled: true });
    const proc = await createCase(session);

    await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.id, content: 'Por e-mail', possibleDueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);

    assert.equal(emailChannel.lastMessage?.to, session.email);
  });

  it('cliente não recebe conteúdo integral e só é avisado se autorizar', async () => {
    const session = await helper.registerAndLogin();
    await configureChannels(session);
    const proc = await createCase(session);

    const clientRes = await request(app)
      .post('/api/clients')
      .set('Cookie', session.cookie)
      .send({ name: 'Cliente Teste', email: 'cliente@test.com' })
      .expect(201);
    const clientId = clientRes.body.id;
    await request(app).patch(`/api/processes/${proc.id}`).set('Cookie', session.cookie).send({ clientId, responsibleId: session.userId }).expect(200);

    await request(app).put(`/api/clients/${clientId}/notification-preferences`).set('Cookie', session.cookie).send({
      processUpdatesEnabled: true, emailEnabled: true,
    }).expect(200);

    await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.id, content: 'CONTEÚDO SENSÍVEL DA INTIMAÇÃO que não deve ir ao cliente', possibleDueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);

    // último e-mail enviado é o do cliente (advogado foi avisado antes); mensagem genérica
    assert.equal(emailChannel.lastMessage?.to, 'cliente@test.com');
    assert.ok(!(emailChannel.lastMessage?.body ?? '').includes('CONTEÚDO SENSÍVEL'));
  });

  it('cliente com preferências desabilitadas não recebe aviso', async () => {
    const session = await helper.registerAndLogin();
    await configureChannels(session);
    const proc = await createCase(session);
    const clientRes = await request(app)
      .post('/api/clients')
      .set('Cookie', session.cookie)
      .send({ name: 'Cliente Quieto', email: 'quieto@test.com' })
      .expect(201);
    await request(app).patch(`/api/processes/${proc.id}`).set('Cookie', session.cookie).send({ clientId: clientRes.body.id, responsibleId: session.userId }).expect(200);

    await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.id, content: 'Intimação', possibleDueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);

    assert.equal(emailChannel.lastMessage?.to, session.email); // só o advogado recebe
  });

  it('usuário de outra organização não recebe notificação', async () => {
    const a = await helper.registerAndLogin();
    await configureChannels(a);
    const b = await helper.registerAndLogin();
    await configureChannels(b);
    const proc = await createCase(a);

    await request(app)
      .post('/api/publications')
      .set('Cookie', a.cookie)
      .send({ processId: proc.id, content: 'Intimação org A', possibleDueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);

    const deliveriesB = await request(app).get('/api/notifications/deliveries').set('Cookie', b.cookie).expect(200);
    assert.equal(deliveriesB.body.items.length, 0);
    assert.equal(emailChannel.lastMessage?.to, a.email);
  });

  it('new_publication desabilitada impede envio mesmo com email habilitado', async () => {
    const session = await helper.registerAndLogin();
    await configureChannels(session);
    await setPrefs(session.cookie, { emailEnabled: true, newPublication: false });
    const proc = await createCase(session);

    await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.id, content: 'Sem nova publicação', possibleDueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);

    assert.equal(emailChannel.lastMessage, null);
  });

  it('cliente autorizado recebe e-mail genérico/controlado', async () => {
    const session = await helper.registerAndLogin();
    await configureChannels(session);
    const proc = await createCase(session);
    const clientRes = await request(app)
      .post('/api/clients')
      .set('Cookie', session.cookie)
      .send({ name: 'Cliente Email', email: 'cliente@example.com' })
      .expect(201);
    await request(app).patch(`/api/processes/${proc.id}`).set('Cookie', session.cookie).send({ clientId: clientRes.body.id, responsibleId: session.userId }).expect(200);

    await request(app).put(`/api/clients/${clientRes.body.id}/notification-preferences`).set('Cookie', session.cookie).send({
      processUpdatesEnabled: true, emailEnabled: true,
    }).expect(200);

    await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.id, content: 'CONTEÚDO INTERNO SIGILOSO', possibleDueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);

    // o último e-mail enviado é o do cliente (advogado já foi avisado antes)
    assert.equal(emailChannel.lastMessage?.to, 'cliente@example.com');
    assert.ok(!(emailChannel.lastMessage?.body ?? '').includes('CONTEÚDO INTERNO SIGILOSO'));
    assert.ok(!(emailChannel.lastMessage?.body ?? '').includes('ANÁLISE'));
  });

  it('cliente com email desabilitado não recebe aviso', async () => {
    const session = await helper.registerAndLogin();
    await configureChannels(session);
    const proc = await createCase(session);
    const clientRes = await request(app)
      .post('/api/clients')
      .set('Cookie', session.cookie)
      .send({ name: 'Cliente Sem Email', email: 'sem@example.com' })
      .expect(201);
    await request(app).patch(`/api/processes/${proc.id}`).set('Cookie', session.cookie).send({ clientId: clientRes.body.id, responsibleId: session.userId }).expect(200);

    await request(app).put(`/api/clients/${clientRes.body.id}/notification-preferences`).set('Cookie', session.cookie).send({
      processUpdatesEnabled: true, emailEnabled: false,
    }).expect(200);

    await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.id, content: 'Intimação', possibleDueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);

    // cliente não recebeu; apenas o advogado (responsável) recebeu o e-mail
    assert.equal(emailChannel.lastMessage?.to, session.email);
  });

  it('SMTP não configurado registra NOT_CONFIGURED, não finge envio', async () => {
    const { EmailChannel } = await import('../src/notify/email');
    setNotificationChannelsForTests([new EmailChannel()]);
    const session = await helper.registerAndLogin();
    // não configura o canal EMAIL: SMTP ausente
    const proc = await createCase(session);

    await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.id, content: 'Intimação sem SMTP', possibleDueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);

    const deliveries = await request(app).get('/api/notifications/deliveries').set('Cookie', session.cookie).expect(200);
    const emailDeliveries = deliveries.body.items.filter((d: { channel: string }) => d.channel === 'EMAIL');
    assert.ok(emailDeliveries.length >= 1);
    assert.equal(emailDeliveries[0].status, 'NOT_CONFIGURED');
  });

  it('falha do provider SMTP registra FAILED com erro', async () => {
    setNotificationChannelsForTests([new FakeFailingEmailChannel()]);
    const session = await helper.registerAndLogin();
    await request(app).put('/api/notifications/channels').set('Cookie', session.cookie).send({
      channel: 'EMAIL', enabled: true, config: { host: 'smtp.test.com', port: 587, user: 'u', pass: 'p', from: 'test@test.com' },
    }).expect(200);
    const proc = await createCase(session);

    await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.id, content: 'Intimação que falha', possibleDueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);

    const deliveries = await request(app).get('/api/notifications/deliveries').set('Cookie', session.cookie).expect(200);
    const emailDeliveries = deliveries.body.items.filter((d: { channel: string }) => d.channel === 'EMAIL');
    assert.ok(emailDeliveries.length >= 1);
    assert.equal(emailDeliveries[0].status, 'FAILED');
    assert.ok(emailDeliveries[0].error);
  });
});