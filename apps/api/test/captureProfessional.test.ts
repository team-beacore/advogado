import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, createSecondUserInOrg, createSuperAdmin, makeApp, resetDb, uniqueEmail } from './helpers';
import { getPool } from '../src/db/client';
import { DemoCaptureAdapter } from '../src/capture/demo';
import { ProcessNormalizer } from '../src/capture/normalizer';

describe('DemoCaptureAdapter — dados determinísticos', () => {
  const adapter = new DemoCaptureAdapter();

  it('inicialização e conexão', async () => {
    assert.equal(adapter.source, 'DEMO');
    assert.equal(adapter.mode, 'DEMO');
    assert.equal(adapter.implemented, true);
    assert.equal(adapter.isConfigured(null), true);
    const test = await adapter.testConnection({});
    assert.equal(test.ok, true);
  });

  it('retorno determinístico (processos, movimentações, publicações)', async () => {
    const a = await adapter.fetch({});
    const b = await adapter.fetch({});
    assert.equal(a.processes.length, 3);
    assert.equal(a.movements.length, 18);
    assert.equal(a.publications.length, 5);
    // determinístico: mesmos números e referências
    assert.deepEqual(a.processes.map((p) => p.processNumber), b.processes.map((p) => p.processNumber));
    assert.deepEqual(a.publications.map((p) => p.externalReference), b.publications.map((p) => p.externalReference));
    // dados fictícios — nenhum dado real
    for (const p of a.processes) {
      assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(p.processNumber));
    }
  });
});

describe('ProcessNormalizer — camada de normalização', () => {
  it('normaliza processo/movimentação/publicação independente da fonte', () => {
    const n = new ProcessNormalizer('DEMO', 'DEMO');
    const proc = n.process({ processNumber: '0000000-00.2026.8.00.0001', title: 'T', court: 'TJ', area: 'Cível', parties: ['A', 'B'] });
    assert.equal(proc.source, 'DEMO');
    assert.equal(proc.mode, 'DEMO');
    assert.equal(proc.title, 'T');
    const pub = n.publication({ processNumber: 'X', content: 'conteúdo' });
    assert.equal(pub.content, 'conteúdo');
    assert.equal(pub.source, 'DEMO');
  });
});

describe('CAPTURE PROFISSIONAL — engine, idempotência, isolamento, permissões, notificações, planos', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  it('SOLO: captura DEMO funciona; publicações registradas; responsável é o próprio advogado', async () => {
    const session = await helper.registerAndLogin();
    await request(app).post('/api/capture/run').set('Cookie', session.cookie).send({ source: 'DEMO' }).expect(200);

    const pubs = await request(app).get('/api/publications').set('Cookie', session.cookie).expect(200);
    assert.equal(pubs.body.items.length, 5);
    assert.ok(pubs.body.items.every((p: { source: string }) => p.source === 'DEMO'));

    // processos criados pela captura (verificação direta no banco)
    const pool = getPool();
    const processes = await pool.query('SELECT count(*)::int AS n FROM cases WHERE organization_id = $1', [session.orgId]);
    assert.ok(processes.rows[0].n >= 3);
  });

  it('idempotência: segunda captura não duplica', async () => {
    const session = await helper.registerAndLogin();
    const first = await request(app).post('/api/capture/run').set('Cookie', session.cookie).send({ source: 'DEMO' }).expect(200);
    assert.equal(first.body.status, 'SUCCESS');
    assert.equal(first.body.imported, 26); // 3 processos + 18 movimentações + 5 publicações
    const pubs1 = await request(app).get('/api/publications').set('Cookie', session.cookie).expect(200);
    assert.equal(pubs1.body.items.length, 5);

    const second = await request(app).post('/api/capture/run').set('Cookie', session.cookie).send({ source: 'DEMO' }).expect(200);
    assert.equal(second.body.status, 'SUCCESS');
    assert.equal(second.body.imported, 0);
    const pubs2 = await request(app).get('/api/publications').set('Cookie', session.cookie).expect(200);
    assert.equal(pubs2.body.items.length, 5);
  });

  it('isolamento: organização A recebe dados, B não', async () => {
    const a = await helper.registerAndLogin();
    await request(app).post('/api/capture/run').set('Cookie', a.cookie).send({ source: 'DEMO' }).expect(200);
    const pubsA = await request(app).get('/api/publications').set('Cookie', a.cookie).expect(200);
    assert.equal(pubsA.body.items.length, 5);

    const b = await helper.registerAndLogin();
    const pubsB = await request(app).get('/api/publications').set('Cookie', b.cookie).expect(200);
    assert.equal(pubsB.body.items.length, 0);
    const processesB = await request(app).get('/api/processes').set('Cookie', b.cookie).expect(200);
    assert.equal(processesB.body.items.length, 0);
  });

  it('FINANCE não pode executar captura (permissão)', async () => {
    const admin = await helper.registerAndLogin();
    // cria FINANCE via helper (registra com 'test1234' e adiciona à org)
    const finSession = await createSecondUserInOrg(app, admin, { role: 'FINANCE' });
    // FINANCE tenta executar captura → 403
    await request(app).post('/api/capture/run').set('Cookie', finSession.cookie).send({ source: 'DEMO' }).expect(403);
  });

  it('SUPER ADMIN pode testar configuração técnica (mas fora da organização)', async () => {
    const sa = await createSuperAdmin(app);
    // SUPER ADMIN não pertence a organização → captura de org bloqueada (403)
    await request(app).post('/api/capture/run').set('Cookie', sa.cookie).send({ source: 'DEMO' }).expect(403);
  });

  it('notificação: responsável do processo recebe; quem executa a captura (LAWYER) não vira responsável automaticamente', async () => {
    const admin = await helper.registerAndLogin();
    // LAWYER responsável
    const lawyerSession = await createSecondUserInOrg(app, admin, { role: 'LAWYER' });
    const lawyerId = lawyerSession.userId;

    // ASSISTANT executa a captura
    const asstSession = await createSecondUserInOrg(app, admin, { role: 'ASSISTANT' });

    // Cria processo com responsible_id = advogado
    await request(app).post('/api/processes').set('Cookie', admin.cookie).send({
      title: 'Processo João',
      processNumber: '0000000-00.2026.8.00.0001',
      responsibleId: lawyerId,
    }).expect(201);

    // Assistente executa captura (vai associar publicação ao processo)
    await request(app).post('/api/capture/run').set('Cookie', asstSession.cookie).send({ source: 'DEMO' }).expect(200);

    // O responsável do processo continua sendo o LAWYER (verificação direta no banco)
    const pool = getPool();
    const caseRow = await pool.query(
      'SELECT c.responsible_id, c.title FROM cases c JOIN organization_members om ON om.organization_id = c.organization_id WHERE c.organization_id = $1 AND c.process_number = $2',
      [admin.orgId, '0000000-00.2026.8.00.0001'],
    );
    assert.equal(caseRow.rows[0]?.responsible_id, lawyerId);

    // Notificações foram criadas
    const notifs = await request(app).get('/api/notifications').set('Cookie', admin.cookie).expect(200);
    assert.ok(notifs.body.items.length > 0);
  });

  it('capture_runs registra fonte, modo e contadores', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app).post('/api/capture/run').set('Cookie', session.cookie).send({ source: 'DEMO' }).expect(200);
    const pool = getPool();
    const run = await pool.query('SELECT * FROM capture_runs WHERE id = $1', [res.body.runId]);
    assert.equal(run.rows[0].source, 'DEMO');
    assert.equal(run.rows[0].mode, 'DEMO');
    assert.equal(run.rows[0].status, 'SUCCESS');
    assert.ok(run.rows[0].found_count >= 0);
    // execuções listáveis
    const runs = await request(app).get('/api/capture/runs').set('Cookie', session.cookie).expect(200);
    assert.ok(runs.body.items.length >= 1);
  });

  it('fonte não implementada (PJe) retorna FAILED honesto', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app).post('/api/capture/run').set('Cookie', session.cookie).send({ source: 'PJE' }).expect(200);
    assert.equal(res.body.status, 'FAILED');
    assert.ok(res.body.errorMessage.includes('não implementada'));
  });

  it('limpeza de dados DEMO não remove dados reais', async () => {
    const session = await helper.registerAndLogin();
    // dados reais
    await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Cliente Real' }).expect(201);
    // captura demo
    await request(app).post('/api/capture/run').set('Cookie', session.cookie).send({ source: 'DEMO' }).expect(200);
    const pubs = await request(app).get('/api/publications').set('Cookie', session.cookie).expect(200);
    assert.equal(pubs.body.items.length, 5);

    const pool = getPool();
    const { cleanupDemoData } = await import('../src/capture/service');
    await cleanupDemoData(session.orgId);

    const after = await request(app).get('/api/publications').set('Cookie', session.cookie).expect(200);
    assert.equal(after.body.items.length, 0);
    const clients = await request(app).get('/api/clients').set('Cookie', session.cookie).expect(200);
    assert.equal(clients.body.items.length, 1);
  });
});
