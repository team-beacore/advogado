import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb } from './helpers';
import { setAIProviderForTests } from '../src/ai/registry';
import type { AIProvider, AIRequest, AIResponse } from '../src/ai/provider';

class FakeProvider implements AIProvider {
  readonly name = 'fake';
  isConfigured(): boolean {
    return true;
  }
  async generate(req: AIRequest): Promise<AIResponse> {
    if (req.operation === 'RESUME') {
      return {
        text: JSON.stringify({
          resumo: 'Resumo do processo X',
          fatosImportantes: ['Fato 1'],
          eventosRecentes: ['Evento 1'],
          pontosAtencao: ['Atenção 1'],
          informacoesAusentes: ['Nenhuma'],
        }),
        model: 'fake-model',
      };
    }
    if (req.operation === 'ANALYZE_INTIMATION') {
      return {
        text: JSON.stringify({
          resumo: 'Intimação para manifestação',
          providencias: [{ acao: 'Apresentar defesa', justificativa: 'Prazo indicado' }],
          informacoesRelevantes: ['Info 1'],
          prazoIdentificado: '15 dias (necessita confirmação humana)',
          verificacaoNecessaria: 'Confirmar prazo junto ao tribunal',
        }),
        model: 'fake-model',
      };
    }
    return {
      text: JSON.stringify({
        rascunho: 'Excelentíssimo Juiz... [RASCUNHO — REVISÃO HUMANA NECESSÁRIA]',
        observacoes: 'Revisar e completar',
        documentosReferenciados: ['Doc 1'],
      }),
      model: 'fake-model',
    };
  }
}

describe('AI', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => {
    await resetDb();
    setAIProviderForTests(new FakeProvider());
  });
  after(async () => {
    setAIProviderForTests(null);
    const { closePool } = await import('../src/db/client');
    await closePool();
  });
  beforeEach(async () => { await resetDb(); });

  async function createCase(session: { cookie: string }) {
    const res = await request(app)
      .post('/api/processes')
      .set('Cookie', session.cookie)
      .send({ title: 'Proc AI', processNumber: '6666-66.2024.8.01.0001' })
      .expect(201);
    return res.body;
  }

  it('returns AI_NOT_CONFIGURED when provider not configured', async () => {
    setAIProviderForTests(null);
    try {
      const session = await helper.registerAndLogin();
      const proc = await createCase(session);
      const res = await request(app)
        .post(`/api/ai/processes/${proc.id}/summarize`)
        .set('Cookie', session.cookie)
        .expect(503);
      assert.equal(res.body.code, 'AI_NOT_CONFIGURED');
    } finally {
      setAIProviderForTests(new FakeProvider());
    }
  });

  it('status endpoint reflects configuration', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app).get('/api/ai/status').set('Cookie', session.cookie).expect(200);
    assert.equal(res.body.configured, true);
    assert.equal(res.body.provider, 'fake');
    assert.ok(res.body.disclaimer);
  });

  it('executes summarize and records interaction', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    const res = await request(app)
      .post(`/api/ai/processes/${proc.id}/summarize`)
      .set('Cookie', session.cookie)
      .expect(200);
    assert.ok(res.body.interactionId);
    assert.ok(res.body.structured);
    assert.equal(res.body.structured.resumo, 'Resumo do processo X');
    assert.ok(res.body.disclaimer);

    const interactions = await request(app).get(`/api/ai/interactions?processId=${proc.id}`).set('Cookie', session.cookie).expect(200);
    assert.equal(interactions.body.items.length, 1);
    assert.equal(interactions.body.items[0].type, 'RESUME');
  });

  it('adds AI_EXECUTED timeline event', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    await request(app).post(`/api/ai/processes/${proc.id}/summarize`).set('Cookie', session.cookie).expect(200);
    const detail = await request(app).get(`/api/processes/${proc.id}`).set('Cookie', session.cookie).expect(200);
    assert.ok(detail.body.events.some((e: { type: string }) => e.type === 'AI_EXECUTED'));
  });

  it('logs audit entry for AI execution', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    await request(app).post(`/api/ai/processes/${proc.id}/summarize`).set('Cookie', session.cookie).expect(200);
    const logs = await request(app).get('/api/audit?entity=ai_interaction').set('Cookie', session.cookie).expect(200);
    assert.ok(logs.body.items.some((l: { action: string }) => l.action === 'AI_EXECUTED'));
  });

  it('approves an AI interaction', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    const run = await request(app).post(`/api/ai/processes/${proc.id}/summarize`).set('Cookie', session.cookie).expect(200);
    const review = await request(app)
      .post(`/api/ai/interactions/${run.body.interactionId}/review`)
      .set('Cookie', session.cookie)
      .send({ status: 'APPROVED' })
      .expect(200);
    assert.equal(review.body.approval.status, 'APPROVED');

    const interactions = await request(app).get(`/api/ai/interactions?processId=${proc.id}`).set('Cookie', session.cookie).expect(200);
    assert.equal(interactions.body.items[0].approvals[0].status, 'APPROVED');
  });

  it('rejects an AI interaction', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    const run = await request(app).post(`/api/ai/processes/${proc.id}/summarize`).set('Cookie', session.cookie).expect(200);
    const review = await request(app)
      .post(`/api/ai/interactions/${run.body.interactionId}/review`)
      .set('Cookie', session.cookie)
      .send({ status: 'REJECTED' })
      .expect(200);
    assert.equal(review.body.approval.status, 'REJECTED');
  });

  it('edits an AI interaction (requires editedOutput)', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    const run = await request(app).post(`/api/ai/processes/${proc.id}/summarize`).set('Cookie', session.cookie).expect(200);
    // editing without output -> 400
    await request(app)
      .post(`/api/ai/interactions/${run.body.interactionId}/review`)
      .set('Cookie', session.cookie)
      .send({ status: 'EDITED' })
      .expect(400);
    // editing with output -> 200
    const review = await request(app)
      .post(`/api/ai/interactions/${run.body.interactionId}/review`)
      .set('Cookie', session.cookie)
      .send({ status: 'EDITED', editedOutput: { resumo: 'Versão editada pelo advogado' } })
      .expect(200);
    assert.equal(review.body.approval.status, 'EDITED');
  });

  it('records AI_REVIEWED timeline event', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    const run = await request(app).post(`/api/ai/processes/${proc.id}/summarize`).set('Cookie', session.cookie).expect(200);
    await request(app)
      .post(`/api/ai/interactions/${run.body.interactionId}/review`)
      .set('Cookie', session.cookie)
      .send({ status: 'APPROVED' })
      .expect(200);
    const detail = await request(app).get(`/api/processes/${proc.id}`).set('Cookie', session.cookie).expect(200);
    assert.ok(detail.body.events.some((e: { type: string }) => e.type === 'AI_REVIEWED'));
  });

  it('analyzes an intimação', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    const pub = await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.id, content: 'Prazo de 15 dias para manifestação.' })
      .expect(201);
    const res = await request(app)
      .post(`/api/ai/processes/${proc.id}/analyze-publication/${pub.body.id}`)
      .set('Cookie', session.cookie)
      .expect(200);
    assert.equal(res.body.operation, 'ANALYZE_INTIMATION');
    assert.ok(res.body.structured.prazoIdentificado);
  });

  it('suggests a draft', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    const res = await request(app)
      .post(`/api/ai/processes/${proc.id}/draft`)
      .set('Cookie', session.cookie)
      .send({ instruction: 'Elabore uma contestação.' })
      .expect(200);
    assert.equal(res.body.operation, 'DRAFT');
    assert.ok(res.body.structured.rascunho);
    assert.ok(res.body.disclaimer);
  });
});