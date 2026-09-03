import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, createSecondUserInOrg, createSuperAdmin, makeApp, resetDb } from './helpers';
import { getPool } from '../src/db/client';
import { DjenDiscoveryProvider } from '../src/capture/djen/provider';
import type { DJENTransport } from '../src/capture/djen/client';
import { setDiscoveryProvidersForTests } from '../src/capture/discovery/registry';
import { syncCase } from '../src/capture/sync/service';

/**
 * ETAPA 13 — INTEGRAÇÃO: DJEN provider → discovery service → persistência → revisão → importação → DataJud.
 *
 * NOTA DE VALIDAÇÃO: este é um TESTE DE INTEGRAÇÃO com transporte CONTROLADO (mock HTTP).
 * A VALIDAÇÃO REAL (chamada HTTP ao DJEN oficial) é feita por script dedicado, separada deste teste.
 * Aqui provamos que o fluxo completo da plataforma funciona quando o DJEN responde.
 */

const IDENTITY = { professionalName: 'Dr. João Silva', oabNumber: '123456', oabState: 'RJ' };
// O provider normaliza o número para o formato mascarado (parseCNJ) antes de persistir.
const CNJ_1 = '0000832-35.2018.4.01.3202';
const CNJ_2 = '0000001-89.2020.8.19.0001';

function djenHttpOk(body: unknown): DJENTransport {
  return async () => ({ status: 200, headers: { get: () => null }, json: async () => body });
}

/** Resposta realista do DJEN: 2 comunicações com destinatário advogado confirmado. */
function djenBody(): unknown {
  return {
    status: 'success',
    count: 2,
    items: [
      {
        id: 1,
        numero_processo: '00008323520184013202',
        siglaTribunal: 'TRF1',
        tipoComunicacao: 'Intimação',
        data_disponibilizacao: '2026-09-01T10:00:00.000Z',
        nomeClasse: 'Procedimento do Juizado Especial Cível',
        destinatarioadvogados: [{ advogado: { nome: 'João Silva', numero_oab: '123456', uf_oab: 'RJ' } }],
      },
      {
        id: 2,
        numero_processo: '00000018920208190001',
        siglaTribunal: 'TJRJ',
        tipoComunicacao: 'Citação',
        data_disponibilizacao: '2026-09-02T11:00:00.000Z',
        destinatarioadvogados: [{ advogado: { nome: 'João Silva', numero_oab: '123456', uf_oab: 'RJ' } }],
      },
    ],
  };
}

describe('ETAPA 13 — FLUXO DJEN (integração controlada)', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);
  let providerOverride: DjenDiscoveryProvider;

  before(async () => { await resetDb(); });
  after(async () => {
    setDiscoveryProvidersForTests(null);
    const { closePool } = await import('../src/db/client');
    await closePool();
  });
  beforeEach(async () => {
    await resetDb();
    providerOverride = new DjenDiscoveryProvider(djenHttpOk(djenBody()));
    setDiscoveryProvidersForTests([providerOverride]);
  });

  async function setupOrg() {
    const session = await helper.registerAndLogin();
    await request(app).put('/api/professional-identity/me').set('Cookie', session.cookie).send(IDENTITY).expect(201);
    // Habilita a fonte DJEN (configuração por instalação)
    await request(app).put('/api/capture/config').set('Cookie', session.cookie).send({ source: 'DJEN', enabled: true }).expect(200);
    return session;
  }

  it('1. discovery service consulta DJEN (mock) e persiste resultados PENDING_REVIEW com confidence', async () => {
    const session = await setupOrg();
    const res = await request(app).post('/api/process-discovery/run').set('Cookie', session.cookie).send({ source: 'DJEN' }).expect(200);
    assert.equal(res.body.status, 'SUCCESS');
    assert.equal(res.body.processesFound, 2);
    assert.equal(res.body.resultsCreated, 2);
    // nenhum provider "não implementado" é chamado como se fosse real
    const okSteps = res.body.steps.filter((s: { status: string }) => s.status === 'OK');
    assert.equal(okSteps.length, 1);
    assert.equal(okSteps[0].name, 'DJEN (Comunica PJe)');

    const results = await request(app).get('/api/process-discovery/results').set('Cookie', session.cookie).expect(200);
    assert.equal(results.body.items.length, 2);
    assert.ok(results.body.items.every((r: { status: string }) => r.status === 'PENDING_REVIEW'));
    // confidence HIGH (advogado confirmado como destinatário) — NUMERIC do Postgres vem como string
    assert.ok(results.body.items.every((r: { confidence: number | string }) => Number(r.confidence) === 1));
  });

  it('2. fluxo: revisão → importação → Case criado com origem DJEN', async () => {
    const session = await setupOrg();
    await request(app).post('/api/process-discovery/run').set('Cookie', session.cookie).send({ source: 'DJEN' }).expect(200);

    const results = await request(app).get('/api/process-discovery/results').set('Cookie', session.cookie).expect(200);
    // ordenação não determinística → seleciona pelo CNJ
    const target = results.body.items.find((r: { process_number: string }) => r.process_number === CNJ_1);
    const id = target.id;

    // revisão (detalhe)
    const detail = await request(app).get(`/api/process-discovery/results/${id}`).set('Cookie', session.cookie).expect(200);
    assert.equal(detail.body.process_number, CNJ_1);
    assert.equal(detail.body.source, 'DJEN');
    assert.equal(Number(detail.body.confidence), 1);

    // importação
    const imp = await request(app).post(`/api/process-discovery/results/${id}/import`).set('Cookie', session.cookie).send({}).expect(200);
    assert.equal(imp.body.created, true);
    assert.equal(imp.body.duplicate, false);

    const pool = getPool();
    const caseRow = await pool.query('SELECT process_number, source FROM cases WHERE organization_id = $1', [session.orgId]);
    assert.equal(caseRow.rows.length, 1);
    assert.equal(caseRow.rows[0].process_number, CNJ_1);
    assert.equal(caseRow.rows[0].source, 'DJEN');
  });

  it('3. deduplicação: segunda descoberta DJEN não cria duplicatas', async () => {
    const session = await setupOrg();
    await request(app).post('/api/process-discovery/run').set('Cookie', session.cookie).send({ source: 'DJEN' }).expect(200);
    const second = await request(app).post('/api/process-discovery/run').set('Cookie', session.cookie).send({ source: 'DJEN' }).expect(200);
    assert.equal(second.body.resultsCreated, 0);
    assert.equal(second.body.resultsDuplicate, 2);
  });

  it('4. enriquecimento: Case importado é sincronizável com DataJud (movimentações persistidas)', async () => {
    const session = await setupOrg();
    await request(app).post('/api/process-discovery/run').set('Cookie', session.cookie).send({ source: 'DJEN' }).expect(200);
    const results = await request(app).get('/api/process-discovery/results').set('Cookie', session.cookie).expect(200);
    const target = results.body.items.find((r: { process_number: string }) => r.process_number === CNJ_1);
    const imp = await request(app).post(`/api/process-discovery/results/${target.id}/import`).set('Cookie', session.cookie).send({}).expect(200);

    // sync via DataJud (mock controlado de lookup)
    const lookup = async () => ({
      process: { processNumber: CNJ_1, title: 'Processo', court: 'TRF1' },
      movements: [
        { processNumber: CNJ_1, date: '2026-09-03T10:00:00.000Z', occurredAt: '2026-09-03T10:00:00.000Z', description: 'Juntada de documento', sourceReference: 'datajud-mov-26-2026-09-03' },
        { processNumber: CNJ_1, date: '2026-09-04T10:00:00.000Z', occurredAt: '2026-09-04T10:00:00.000Z', description: 'Conclusos para sentença', sourceReference: 'datajud-mov-27-2026-09-04' },
      ],
      metadata: { dataJud: { tribunal: 'TRF1' } },
    });

    const sync = await syncCase(session.orgId, imp.body.caseId, session.userId, undefined, lookup as never);
    assert.equal(sync.status, 'SUCCESS');
    assert.equal(sync.inserted, 2);

    const pool = getPool();
    const events = await pool.query('SELECT * FROM case_events WHERE process_id = $1 AND type = $2', [imp.body.caseId, 'CAPTURE_MOVEMENT']);
    assert.equal(events.rows.length, 2);
    // originated from DataJud enrichment (not DJEN)
    assert.ok(events.rows.every((e: { source: string }) => e.source === 'DATAJUD'));
  });

  it('5. isolamento: resultados de uma organização não aparecem em outra', async () => {
    const orgA = await setupOrg();
    await request(app).post('/api/process-discovery/run').set('Cookie', orgA.cookie).send({ source: 'DJEN' }).expect(200);

    const orgB = await helper.registerAndLogin();
    const resultsB = await request(app).get('/api/process-discovery/results').set('Cookie', orgB.cookie).expect(200);
    assert.equal(resultsB.body.items.length, 0);
  });

  it('6. RBAC: ASSISTANT não executa descoberta; FINANCE não acessa; SUPER ADMIN fora da org', async () => {
    const admin = await setupOrg();
    const assistant = await createSecondUserInOrg(app, admin, { role: 'ASSISTANT' });
    await request(app).post('/api/process-discovery/run').set('Cookie', assistant.cookie).send({ source: 'DJEN' }).expect(403);

    const finance = await createSecondUserInOrg(app, admin, { role: 'FINANCE' });
    await request(app).get('/api/process-discovery/results').set('Cookie', finance.cookie).expect(403);

    const sa = await createSuperAdmin(app);
    await request(app).post('/api/process-discovery/run').set('Cookie', sa.cookie).send({ source: 'DJEN' }).expect(403);
  });

  it('7. sem identidade profissional → descoberta bloqueada honestamente', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app).post('/api/process-discovery/run').set('Cookie', session.cookie).send({ source: 'DJEN' }).expect(400);
    assert.equal(res.body.code, 'VALIDATION');
    assert.ok(res.body.message.includes('Identidade profissional'));
  });
});
