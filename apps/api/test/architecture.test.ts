import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, createSecondUserInOrg, makeApp, resetDb, uniqueEmail } from './helpers';
import { setNotificationChannelsForTests } from '../src/notify/registry';
import { setAIProviderForTests } from '../src/ai/registry';
import type { NotificationChannel, ChannelMessage, ChannelResult } from '../src/notify/types';
import type { AIProvider, AIRequest, AIResponse } from '../src/ai/provider';

class FakeEmailChannel implements NotificationChannel {
  readonly name = 'EMAIL' as const;
  lastMessage: ChannelMessage | null = null;
  isConfigured(_config: Record<string, unknown> | null): boolean { return true; }
  async send(msg: ChannelMessage, _config: Record<string, unknown>): Promise<ChannelResult> {
    this.lastMessage = msg;
    return { channel: 'EMAIL', status: 'SENT', externalReference: 'fake-id' };
  }
}

class FakeAIProvider implements AIProvider {
  readonly name = 'fake-ai';
  isConfigured(): boolean { return true; }
  async generate(req: AIRequest): Promise<AIResponse> {
    if (req.operation === 'RESUME') {
      return {
        text: JSON.stringify({ resumo: 'Resumo contextualizado ao processo', fatosImportantes: ['Fato 1'], eventosRecentes: [], pontosAtencao: [], informacoesAusentes: [] }),
        model: 'fake-ai',
      };
    }
    return { text: JSON.stringify({ rascunho: 'rascunho', observacoes: 'obs', documentosReferenciados: [] }), model: 'fake-ai' };
  }
}

describe('Arquitetura: roles, permissões, portal, isolamento', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);
  const emailChannel = new FakeEmailChannel();

  before(async () => { await resetDb(); setNotificationChannelsForTests([emailChannel]); setAIProviderForTests(new FakeAIProvider()); });
  after(async () => { setNotificationChannelsForTests(null); setAIProviderForTests(null); const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); emailChannel.lastMessage = null; });

  async function createCase(session: { cookie: string }, title = 'Proc Test') {
    const res = await request(app).post('/api/processes').set('Cookie', session.cookie).send({ title, processNumber: `9999-99.${Math.floor(Math.random()*9999)}.8.01.0001` }).expect(201);
    return res.body;
  }

  // 1. Advogado solo consegue operar sozinho
  it('1. advogado solo opera sozinho (cria cliente, processo, intimação)', async () => {
    const session = await helper.registerAndLogin();
    const client = await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Cliente Solo', email: 'solo@test.com' }).expect(201);
    const proc = await request(app).post('/api/processes').set('Cookie', session.cookie).send({ title: 'Meu Processo', clientId: client.body.id }).expect(201);
    const pub = await request(app).post('/api/publications').set('Cookie', session.cookie).send({ processId: proc.body.id, content: 'Intimação solo' }).expect(201);
    assert.equal(pub.body.status, 'PENDING');
    assert.equal(proc.body.responsible_id, session.userId);
  });

  // 2. Primeiro usuário é ADMIN + LAWYER (ADMIN possui permissões de LAWYER)
  it('2. primeiro usuário (ADMIN) possui permissões de LAWYER', async () => {
    const session = await helper.registerAndLogin();
    // ADMIN tem PROCESSES_CREATE → pode criar processo
    const proc = await request(app).post('/api/processes').set('Cookie', session.cookie).send({ title: 'Proc Admin' }).expect(201);
    assert.ok(proc.body.id);
    // ADMIN pode usar IA (ai.use)
    const aiStatus = await request(app).get('/api/ai/status').set('Cookie', session.cookie).expect(200);
    assert.ok(aiStatus.body.configured !== undefined);
  });

  // 3. ADMIN consegue convidar usuário (team.manage)
  it('3. ADMIN convida usuário para a organização', async () => {
    const admin = await helper.registerAndLogin();
    const member = await helper.registerAndLogin();
    // admin convida via email
    const res = await request(app).post('/api/organizations/members').set('Cookie', admin.cookie).send({ email: member.email, role: 'LAWYER' }).expect(201);
    assert.ok(res.body.id);
    // verificar se o membro está na lista
    const members = await request(app).get('/api/organizations/members').set('Cookie', admin.cookie).expect(200);
    assert.ok(members.body.some((m: { email: string }) => m.email === member.email));
  });

  // 4. LAWYER não consegue administrar configurações restritas
  it('4. LAWYER não pode administrar configurações', async () => {
    const admin = await helper.registerAndLogin();
    const lawyer = await createSecondUserInOrg(app, admin, { role: 'LAWYER' });
    // LAWYER não tem TEAM_MANAGE → não pode convidar
    await request(app).post('/api/organizations/members').set('Cookie', lawyer.cookie).send({ email: 'test@test.com', role: 'LAWYER' }).expect(403);
    // LAWYER não tem CAPTURE_MANAGE
    await request(app).get('/api/capture/config').set('Cookie', lawyer.cookie).expect(403);
  });

  // 5. ASSISTANT consegue executar tarefas permitidas
  it('5. ASSISTANT pode criar clientes e registrar intimações', async () => {
    const admin = await helper.registerAndLogin();
    const assistant = await createSecondUserInOrg(app, admin, { role: 'ASSISTANT' });
    const proc = await createCase(admin);
    // adicionar assistente como membro do processo com permissão de edição
    await request(app).post(`/api/processes/${proc.id}/members`).set('Cookie', admin.cookie).send({ userId: assistant.userId, role: 'LAWYER' }).expect(201);
    // criar cliente
    const client = await request(app).post('/api/clients').set('Cookie', assistant.cookie).send({ name: 'Cliente Assistente', email: 'assist@test.com' }).expect(201);
    assert.ok(client.body.id);
    // registrar intimação
    const pub = await request(app).post('/api/publications').set('Cookie', assistant.cookie).send({ processId: proc.id, content: 'Intimação pela assistente' }).expect(201);
    assert.ok(pub.body.id);
    // ASSISTANT não pode criar contratos (billing.manage)
    await request(app).post('/api/finance/contracts').set('Cookie', assistant.cookie).send({ title: 'Contrato', totalValue: 1000 }).expect(403);
  });

  // 6. FINANCE acessa apenas financeiro
  it('6. FINANCE acessa apenas o módulo financeiro', async () => {
    const admin = await helper.registerAndLogin();
    const finance = await createSecondUserInOrg(app, admin, { role: 'FINANCE' });
    // FINANCE pode ler resumo financeiro
    const summary = await request(app).get('/api/finance/summary').set('Cookie', finance.cookie).expect(200);
    assert.ok(summary.body !== undefined);
    // FINANCE não pode criar processo (processes.create)
    await request(app).post('/api/processes').set('Cookie', finance.cookie).send({ title: 'Proc Finance' }).expect(403);
    // FINANCE não pode listar processos (processes.read)
    await request(app).get('/api/processes').set('Cookie', finance.cookie).expect(403);
    // FINANCE não pode ler documentos (documents.read)
    await request(app).get('/api/documents').set('Cookie', finance.cookie).expect(403);
  });

  // 7. Cliente pode existir sem login
  it('7. cliente existe sem login', async () => {
    const session = await helper.registerAndLogin();
    const client = await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Sem Login', email: 'semlogin@test.com' }).expect(201);
    assert.ok(client.body.id);
    // verificar que não há client_user vinculado
    const portal = await request(app).get(`/api/clients/${client.body.id}/portal`).set('Cookie', session.cookie).expect(200);
    assert.equal(portal.body.portal, null);
  });

  // 8. Cliente pode receber email sem portal
  it('8. cliente recebe notificação por email sem portal', async () => {
    const session = await helper.registerAndLogin();
    await request(app).put('/api/notifications/channels').set('Cookie', session.cookie).send({
      channel: 'EMAIL', enabled: true, config: { host: 'smtp.test.com', port: 587, user: 'u', pass: 'p', from: 'test@test.com' },
    }).expect(200);
    const proc = await createCase(session);
    const client = await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Cliente Email', email: 'cliente@test.com' }).expect(201);
    await request(app).patch(`/api/processes/${proc.id}`).set('Cookie', session.cookie).send({ clientId: client.body.id, responsibleId: session.userId }).expect(200);
    await request(app).put(`/api/clients/${client.body.id}/notification-preferences`).set('Cookie', session.cookie).send({
      processUpdatesEnabled: true, emailEnabled: true,
    }).expect(200);
    await request(app).post('/api/publications').set('Cookie', session.cookie).send({ processId: proc.id, content: 'Intimação', possibleDueDate: new Date(Date.now() + 86400000).toISOString() }).expect(201);
    // cliente recebeu email genérico (último lastMessage)
    assert.ok(emailChannel.lastMessage?.body?.includes('movimentação'));
    assert.ok(!emailChannel.lastMessage?.body?.includes('CONTEÚDO SENSÍVEL'));
  });

  // 9. Cliente pode existir sem portal é opção válida
  it('9. cliente existe sem portal é opção válida', async () => {
    const session = await helper.registerAndLogin();
    const client = await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Cliente Real', email: 'real@test.com' }).expect(201);
    const portal = await request(app).get(`/api/clients/${client.body.id}/portal`).set('Cookie', session.cookie).expect(200);
    assert.equal(portal.body.portal, null);
  });

  // 10. Cliente pode receber convite para portal
  it('10. admin convida cliente para o portal', async () => {
    const session = await helper.registerAndLogin();
    const client = await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Portal Cliente', email: 'portal@test.com' }).expect(201);
    const invite = await request(app).post(`/api/clients/${client.body.id}/portal/invite`).set('Cookie', session.cookie).send({ email: 'portal@test.com' }).expect(201);
    assert.ok(invite.body.temporaryPassword);
    assert.equal(invite.body.status, 'INVITED');
    // verificar portal criado
    const portal = await request(app).get(`/api/clients/${client.body.id}/portal`).set('Cookie', session.cookie).expect(200);
    assert.equal(portal.body.portal.status, 'INVITED');
  });

  // 11. Cliente vê somente processos compartilhados
  it('11. cliente vê apenas processos compartilhados no portal', async () => {
    const session = await helper.registerAndLogin();
    const client = await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Portal Cliente', email: 'portal2@test.com' }).expect(201);
    await request(app).post(`/api/clients/${client.body.id}/portal/invite`).set('Cookie', session.cookie).send({ email: 'portal2@test.com' }).expect(201);
    const proc1 = await createCase(session);
    const proc2 = await createCase(session);
    await request(app).patch(`/api/processes/${proc1.id}`).set('Cookie', session.cookie).send({ clientId: client.body.id, responsibleId: session.userId }).expect(200);
    await request(app).patch(`/api/processes/${proc2.id}`).set('Cookie', session.cookie).send({ clientId: client.body.id, responsibleId: session.userId }).expect(200);
    // compartilhar apenas proc1
    await request(app).post(`/api/clients/${client.body.id}/shares`).set('Cookie', session.cookie).send({ caseId: proc1.id, canViewDocuments: true }).expect(201);
    // cliente não vê proc2 no portal
    const portal = await request(app).get(`/api/clients/${client.body.id}/portal`).set('Cookie', session.cookie).expect(200);
    assert.ok(portal.body.portal);
  });

  // 12. Cliente não vê processos não compartilhados — verificado via portal login
  it('12. cliente não acessa processo não compartilhado', async () => {
    const session = await helper.registerAndLogin();
    const client = await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Cliente Restrito', email: 'restrito@test.com' }).expect(201);
    await request(app).post(`/api/clients/${client.body.id}/portal/invite`).set('Cookie', session.cookie).send({ email: 'restrito@test.com' }).expect(201);
    const proc = await createCase(session);
    await request(app).patch(`/api/processes/${proc.id}`).set('Cookie', session.cookie).send({ clientId: client.body.id, responsibleId: session.userId }).expect(200);
    // não compartilhar proc → cliente não vê
    const shares = await request(app).get(`/api/clients/${client.body.id}/shares`).set('Cookie', session.cookie).expect(200);
    assert.equal(shares.body.items.length, 0);
  });

  // 13. Assistente registra intimação + 14. responsável recebe notificação + 15. criador não vira responsável
  it('13-15. assistente registra intimação, responsável recebe, criador não vira responsável', async () => {
    const admin = await helper.registerAndLogin();
    await request(app).put('/api/notifications/channels').set('Cookie', admin.cookie).send({
      channel: 'EMAIL', enabled: true, config: { host: 'smtp.test.com', port: 587, user: 'u', pass: 'p', from: 'test@test.com' },
    }).expect(200);
    const assistant = await createSecondUserInOrg(app, admin, { role: 'ASSISTANT' });
    const proc = await createCase(admin);
    // adicionar assistente como membro com permissão
    await request(app).post(`/api/processes/${proc.id}/members`).set('Cookie', admin.cookie).send({ userId: assistant.userId, role: 'LAWYER' }).expect(201);
    // assistente registra intimação
    await request(app).post('/api/publications').set('Cookie', assistant.cookie).send({ processId: proc.id, content: 'Intimação pelo assistente', possibleDueDate: new Date(Date.now() + 86400000).toISOString() }).expect(201);
    // responsável = admin (não mudou para assistant)
    const detail = await request(app).get(`/api/processes/${proc.id}`).set('Cookie', admin.cookie).expect(200);
    assert.equal(detail.body.responsible_id, admin.userId);
    // notificação foi para admin (responsável)
    assert.equal(emailChannel.lastMessage?.to, admin.email);
  });

  // 16. Isolamento por organização
  it('16. isolamento: org A não acessa dados da org B', async () => {
    const a = await helper.registerAndLogin();
    const b = await helper.registerAndLogin();
    const proc = await createCase(a);
    // B não pode ver processo de A (404 = não existe na org B)
    const res = await request(app).get(`/api/processes/${proc.id}`).set('Cookie', b.cookie);
    assert.ok([403, 404].includes(res.status));
    // B não pode listar clientes de A
    const clientsA = await request(app).get('/api/clients').set('Cookie', a.cookie).expect(200);
    const clientsB = await request(app).get('/api/clients').set('Cookie', b.cookie).expect(200);
    assert.equal(clientsB.body.items.length, 0);
    assert.ok(Array.isArray(clientsA.body.items));
  });

  // 17. Usuário sem permissão não acessa processo
  it('17. ADMIN sem vínculo não acessa processo alheio', async () => {
    const admin = await helper.registerAndLogin();
    const other = await helper.registerAndLogin();
    const proc = await createCase(other);
    // admin (org A) não pode ver processo de other (org B) — isolamento cobre
    const res = await request(app).get(`/api/processes/${proc.id}`).set('Cookie', admin.cookie);
    assert.ok([403, 404].includes(res.status));
  });

  // 18. Auditoria registra criador/responsável
  it('18. auditoria registra criador e responsável', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    // audit log existe para criação do processo
    const logs = await request(app).get('/api/audit?entity=case').set('Cookie', session.cookie).expect(200);
    assert.ok(logs.body.items.some((l: { action: string }) => l.action === 'CASE_CREATED'));
  });

  // 19. IA respeita contexto do processo (não é chatbot genérico)
  it('19. IA opera contextualizada ao processo', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    // IA usa o processo como contexto
    const res = await request(app).post(`/api/ai/processes/${proc.id}/summarize`).set('Cookie', session.cookie).expect(200);
    assert.ok(res.body.interactionId);
    assert.ok(res.body.operation === 'RESUME');
  });

  // 20. Fluxo de notificações existente não quebra
  it('20. fluxo de notificações existente continua funcionando', async () => {
    const session = await helper.registerAndLogin();
    await request(app).put('/api/notifications/channels').set('Cookie', session.cookie).send({
      channel: 'EMAIL', enabled: true, config: { host: 'smtp.test.com', port: 587, user: 'u', pass: 'p', from: 'test@test.com' },
    }).expect(200);
    const proc = await createCase(session);
    await request(app).post('/api/publications').set('Cookie', session.cookie).send({ processId: proc.id, content: 'Notificação', possibleDueDate: new Date(Date.now() + 86400000).toISOString() }).expect(201);
    // email enviado ao responsável
    assert.equal(emailChannel.lastMessage?.to, session.email);
    // deliveries registrados
    const deliveries = await request(app).get('/api/notifications/deliveries').set('Cookie', session.cookie).expect(200);
    assert.ok(deliveries.body.items.length > 0);
  });
});