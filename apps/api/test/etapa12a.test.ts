import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb } from './helpers';
import { getPool } from '../src/db/client';
import { normalizeDataJudSource, parseDataJudDate } from '../src/capture/datajud/normalize';
import { normalizePJeProcess } from '../src/capture/pje/normalize';
import { syncCase } from '../src/capture/sync/service';
import type { PJeProcessoHeader } from '../src/capture/pje/types';

/**
 * ETAPA 12A — Corrige a normalização e preserva os dados judiciais.
 *
 * Fixture REAL do teste DataJud já realizado (chamada real, processo
 * 00008323520184013202, TRF1, sistema PJe, grau JE, JEF Adj - Tefé,
 * assunto "Concessão", 43 movimentações).
 */

/** Gera 43 movimentações realistas (códigos/nomes/complementos variados). */
function buildMovements(seed: number): Array<{
  codigo: number;
  dataHora: string;
  nome: string;
  complementosTabelados?: Array<{ codigo: number; descricao?: string; nome?: string; valor?: number }>;
}> {
  const nomes = [
    'Distribuição', 'Autos conclusos', 'Conclusos para sentença', 'Decisão', 'Sentença',
    'Despacho', 'Intimação', 'Citação', 'Juntada de petição', 'Remessa ao juízo',
    'Recebimento', 'Vista ao autor', 'Vista ao réu', 'Designação de audiência', 'Audiência de conciliação',
    'Aguardando pagamento', 'Em cumprimento de sentença', 'Trânsito em julgado', 'Arquivamento', 'Desarquivamento',
    'Emenda à inicial', 'Contestação', 'Réplica', 'Alegações finais', 'Relatório',
    'Remessa à turma recursal', 'Julgamento em segundo grau', 'Baixa definitiva', 'Sobrestamento', 'Suspensão',
    'Certidão', 'Mandado expedido', 'Mandado cumprido', 'Perícia', 'Laudo juntado',
    'Manifestação do MP', 'Acordo homologado', 'Extinção', 'Recurso interposto', 'Recurso processado',
    'Publicação de pauta', 'Audiência de instrução', 'Intimação para manifestação',
  ];
  const movements = [];
  for (let i = 0; i < seed; i++) {
    const codigo = 26 + i;
    const mov: { codigo: number; dataHora: string; nome: string; complementosTabelados?: Array<{ codigo: number; descricao?: string; nome?: string; valor?: number }> } = {
      codigo,
      dataHora: new Date(Date.UTC(2018, 9, 29 + i, 14, 6, 24)).toISOString(),
      nome: nomes[i % nomes.length]!,
    };
    if (i % 3 === 0) {
      mov.complementosTabelados = [
        { codigo: 2, descricao: 'competência exclusiva', valor: 1 },
        { codigo: 7, nome: 'tipo_de_distribuicao_redistribuicao', valor: 3 },
      ];
    } else if (i % 3 === 1) {
      mov.complementosTabelados = [{ codigo: 5, descricao: 'com pedido de gratuidade', valor: 2 }];
    }
    movements.push(mov);
  }
  return movements;
}

/** Payload REAL do DataJud (fixture da ETAPA 12A). */
function buildDataJudFixture(): Record<string, unknown> {
  return {
    id: 'TRF1_JE_00008323520184013202',
    tribunal: 'TRF1',
    grau: 'JE',
    numeroProcesso: '00008323520184013202',
    dataAjuizamento: '20181029000000',
    nivelSigilo: 0,
    orgaoJulgador: { codigo: 16403, nome: 'JEF Adj - Tefé', codigoMunicipioIBGE: 1304063 },
    classe: { codigo: 436, nome: 'Procedimento do Juizado Especial Cível' },
    sistema: { codigo: 1, nome: 'PJe' },
    formato: { codigo: 1, nome: 'Eletrônico' },
    assuntos: [{ codigo: 1477, nome: 'Concessão' }, { codigo: 5678, nome: 'Benefício Previdenciário' }],
    dataHoraUltimaAtualizacao: '2026-06-08T14:55:23.378000Z',
    movimentos: buildMovements(43),
    '@timestamp': '2026-06-08T15:00:00.000Z',
  };
}

describe('ETAPA 12A — fixture real DataJud (00008323520184013202)', () => {
  const fixture = buildDataJudFixture();

  it('1. payload completo: 43 movimentações preservadas', () => {
    const { process, movements } = normalizeDataJudSource(fixture);
    assert.equal(process.processNumber, '0000832-35.2018.4.01.3202');
    assert.equal(movements.length, 43);
  });

  it('2. assuntos preservados (codigo + nome)', () => {
    const { process, metadata } = normalizeDataJudSource(fixture);
    assert.deepEqual(process.subjects, [
      { code: '1477', name: 'Concessão' },
      { code: '5678', name: 'Benefício Previdenciário' },
    ]);
    const dj = metadata.dataJud as Record<string, unknown>;
    assert.deepEqual(dj.assuntos, [
      { code: '1477', name: 'Concessão' },
      { code: '5678', name: 'Benefício Previdenciário' },
    ]);
  });

  it('3. código da movimentação preservado como dado estruturado', () => {
    const { movements } = normalizeDataJudSource(fixture);
    assert.equal(movements[0]!.code, '26');
    assert.ok(movements.every((m) => m.code));
  });

  it('4. nome estruturado preservado (não só texto)', () => {
    const { movements } = normalizeDataJudSource(fixture);
    assert.equal(movements[0]!.name, 'Distribuição');
    assert.ok(movements.every((m) => m.name && m.name.length > 0));
  });

  it('5. complementos tabelados preservados (estrutura, não só texto)', () => {
    const { movements } = normalizeDataJudSource(fixture);
    const first = movements[0]!;
    assert.ok(first.complements && first.complements.length > 0);
    assert.deepEqual(first.complements[0], { code: '2', value: '1', name: null, description: 'competência exclusiva' });
    // a descrição textual ainda existe para exibição
    assert.ok(first.description.includes('competência exclusiva'));
  });

  it('6. formato preservado', () => {
    const { metadata } = normalizeDataJudSource(fixture);
    const dj = metadata.dataJud as { formato?: { codigo?: number | null; nome?: string | null } };
    assert.deepEqual(dj.formato, { codigo: 1, nome: 'Eletrônico' });
  });

  it('7. órgão julgador preservado (nome, código e códigoMunicipioIBGE)', () => {
    const { process, metadata } = normalizeDataJudSource(fixture);
    assert.equal(process.courtName, 'JEF Adj - Tefé');
    assert.equal(process.courtCode, 16403);
    assert.equal(process.courtCityCode, 1304063);
    const dj = metadata.dataJud as { orgaoJulgador?: { codigo?: number | null; nome?: string | null; codigoMunicipioIBGE?: number | null } };
    assert.deepEqual(dj.orgaoJulgador, { codigo: 16403, nome: 'JEF Adj - Tefé', codigoMunicipioIBGE: 1304063 });
  });

  it('8. grau preservado', () => {
    const { process, metadata } = normalizeDataJudSource(fixture);
    assert.equal(process.degree, 'JE');
    const dj = metadata.dataJud as { grau?: string | null };
    assert.equal(dj.grau, 'JE');
  });

  it('9. data de ajuizamento preservada', () => {
    const { process, metadata } = normalizeDataJudSource(fixture);
    assert.equal(process.filingDate, parseDataJudDate('20181029000000')!.toISOString());
    const dj = metadata.dataJud as { dataAjuizamento?: string | null };
    assert.equal(dj.dataAjuizamento, process.filingDate);
  });

  it('10. última atualização preservada (na fonte, não na consulta)', () => {
    const { process, metadata } = normalizeDataJudSource(fixture);
    assert.equal(process.sourceLastUpdatedAt, '2026-06-08T14:55:23.378Z');
    const dj = metadata.dataJud as { dataHoraUltimaAtualizacao?: string | null };
    assert.equal(dj.dataHoraUltimaAtualizacao, '2026-06-08T14:55:23.378Z');
    // NÃO é o @timestamp da consulta
    assert.notEqual(process.sourceLastUpdatedAt, '2026-06-08T15:00:00.000Z');
  });

  it('11. sourceReference preservado e determinístico (idempotência)', () => {
    const a = normalizeDataJudSource(fixture).movements;
    const b = normalizeDataJudSource(fixture).movements;
    assert.deepEqual(a.map((m) => m.sourceReference), b.map((m) => m.sourceReference));
    assert.ok(a[0]!.sourceReference!.startsWith('datajud-mov-'));
  });

  it('12. occurredAt reflete a data do movimento (não created_at da aplicação)', () => {
    const { movements } = normalizeDataJudSource(fixture);
    assert.equal(movements[0]!.occurredAt, movements[0]!.date);
    assert.equal(movements[0]!.occurredAt, '2018-10-29T14:06:24.000Z');
  });

  it('13. payload incompleto não quebra o normalizer', () => {
    const { process, movements } = normalizeDataJudSource({ numeroProcesso: '00008323520184013202' });
    assert.equal(process.processNumber, '0000832-35.2018.4.01.3202');
    assert.equal(movements.length, 0);
    assert.equal(process.degree, null);
    assert.equal(process.subjects, null);
  });

  it('14. casos vazios/indefinidos não quebram', () => {
    const r1 = normalizeDataJudSource({} as Record<string, unknown>);
    assert.equal(r1.process.processNumber, '');
    assert.equal(r1.movements.length, 0);
    const r2 = normalizeDataJudSource(undefined as unknown as Record<string, unknown>);
    assert.equal(r2.process.processNumber, '');
  });

  it('15. classe preservada (código + nome) e título derivado', () => {
    const { process, metadata } = normalizeDataJudSource(fixture);
    assert.equal(process.className, 'Procedimento do Juizado Especial Cível');
    assert.equal(process.classCode, 436);
    assert.ok(process.title!.includes('Procedimento do Juizado Especial Cível'));
    const dj = metadata.dataJud as { classe?: { codigo?: number | null; nome?: string | null } };
    assert.deepEqual(dj.classe, { codigo: 436, nome: 'Procedimento do Juizado Especial Cível' });
  });

  it('16. sistema preservado em judicial_system (area NÃO recebe sistema)', () => {
    const { process } = normalizeDataJudSource(fixture);
    assert.equal(process.judicialSystem, 'PJe');
    assert.equal(process.judicialSystemCode, 1);
    assert.equal(process.area, undefined);
  });

  it('17. DataJud continua funcionando via lookup (mock transport)', async () => {
    const { DataJudCaptureAdapter, lookupDataJudProcess, DEFAULT_DATAJUD_BASE_URL } = await import('../src/capture/datajud/adapter');
    const config = { apiKey: 'x', baseUrl: DEFAULT_DATAJUD_BASE_URL };
    const transport = async () => ({
      status: 200,
      json: async () => ({
        hits: { total: { value: 1 }, hits: [{ _id: 'x', _source: fixture }] },
      }),
    });
    const result = await lookupDataJudProcess('0000832-35.2018.4.01.3202', config, transport as never);
    assert.ok(result);
    assert.equal(result.movements.length, 43);
    assert.equal(result.process.judicialSystem, 'PJe');
    assert.equal(result.process.degree, 'JE');
    assert.ok(result.process.subjects && result.process.subjects.some((s) => s.name === 'Concessão'));
    // metadata chega ao Case via sync (verificado no teste de integração abaixo)
    assert.ok(result.metadata.dataJud);
    const adapter = new DataJudCaptureAdapter(transport as never);
    assert.equal(adapter.isConfigured(config), true);
  });
});

describe('ETAPA 12A — PJe continua funcionando (camada canônica)', () => {
  const PROC: PJeProcessoHeader = {
    id: '12345',
    numeroProcesso: '00008323520184013202',
    tribunal: 'TRF1',
    grau: 'JE',
    nivelSigilo: 'PUBLICO',
    classe: { codigo: 436, nome: 'Procedimento do Juizado Especial Cível' },
    orgaoJulgador: { codigo: 16403, nome: 'Tefé' },
    assunto: 'Concessão',
    dataAjuizamento: '2018-10-29T00:00:00.000Z',
    dataHoraUltimaAtualizacao: '2026-06-08T14:55:23.378Z',
    movimentos: [
      { id: 101, dataHora: '2018-10-30T14:06:24.000Z', tipoMovimento: { codigo: 26, nome: 'Distribuição' }, complementosTabelados: [{ codigo: 2, descricao: 'competência exclusiva' }] },
      { id: 102, dataHora: '2018-10-31T09:00:00.000Z', tipoMovimento: { codigo: 27, nome: 'Autos conclusos' } },
    ],
  };

  it('PJe preserva classe, grau, datas e estrutura de movimentos', () => {
    const { process, movements } = normalizePJeProcess(PROC);
    assert.equal(process.className, 'Procedimento do Juizado Especial Cível');
    assert.equal(process.classCode, 436);
    assert.equal(process.degree, 'JE');
    assert.equal(process.judicialSystem, 'PJe');
    assert.equal(process.filingDate, '2018-10-29T00:00:00.000Z');
    assert.equal(process.sourceLastUpdatedAt, '2026-06-08T14:55:23.378Z');
    assert.deepEqual(process.subjects, [{ code: null, name: 'Concessão' }]);
    assert.equal(movements.length, 2);
    assert.equal(movements[0]!.code, '26');
    assert.equal(movements[0]!.name, 'Distribuição');
    assert.deepEqual(movements[0]!.complements, [{ code: '2', value: null, name: null, description: 'competência exclusiva' }]);
    assert.equal(movements[0]!.occurredAt, '2018-10-30T14:06:24.000Z');
    assert.ok(movements[0]!.sourceReference!.startsWith('pje-mov-'));
  });

  it('PJe com payload incompleto não quebra', () => {
    const { process, movements } = normalizePJeProcess({ numeroProcesso: '00008323520184013202' } as PJeProcessoHeader);
    assert.equal(process.processNumber, '0000832-35.2018.4.01.3202');
    assert.equal(movements.length, 0);
    assert.equal(process.degree, null);
  });
});

describe('ETAPA 12A — integração: sync persiste campos canônicos e estrutura de eventos', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);
  const CNJ = '0000832-35.2018.4.01.3202';

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  async function makeCase(session: { cookie: string }) {
    const res = await request(app).post('/api/processes').set('Cookie', session.cookie).send({
      title: 'Processo ETAPA 12A',
      processNumber: CNJ,
    }).expect(201);
    return res.body;
  }

  function fakeLookupFull() {
    const fixture = buildDataJudFixture();
    return async () => {
      const normalized = normalizeDataJudSource(fixture);
      return normalized;
    };
  }

  it('1. sync persiste class_code, judicial_system, degree, filing_date, subjects, source_metadata no Case', async () => {
    const session = await helper.registerAndLogin();
    const caseRow = await makeCase(session);

    const result = await syncCase(session.orgId, caseRow.id, session.userId, undefined, fakeLookupFull());
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.inserted, 43);

    const pool = getPool();
    const row = (await pool.query('SELECT * FROM cases WHERE id = $1', [caseRow.id])).rows[0];
    assert.equal(row.class_code, '436');
    assert.equal(row.class_name, 'Procedimento do Juizado Especial Cível');
    assert.equal(row.judicial_system, 'PJe');
    assert.equal(row.judicial_system_code, '1');
    assert.equal(row.degree, 'JE');
    assert.equal(row.court, 'TRF1');
    assert.ok(row.filing_date);
    assert.ok(row.source_last_updated_at);
    assert.ok(Array.isArray(row.subjects));
    assert.ok(row.subjects.some((s: { name?: string }) => s.name === 'Concessão'));
    assert.ok(row.source_metadata?.dataJud);
    assert.equal(row.source_metadata.dataJud.formato.nome, 'Eletrônico');
  });

  it('2. sync persiste occurred_at, event_code, event_name e event_metadata nas movimentações', async () => {
    const session = await helper.registerAndLogin();
    const caseRow = await makeCase(session);
    await syncCase(session.orgId, caseRow.id, session.userId, undefined, fakeLookupFull());

    const pool = getPool();
    const events = (await pool.query('SELECT * FROM case_events WHERE process_id = $1 ORDER BY occurred_at ASC LIMIT 3', [caseRow.id])).rows;
    assert.equal(events.length, 3);
    assert.ok(events.every((e) => e.occurred_at));
    assert.ok(events.every((e) => e.event_code));
    assert.ok(events.every((e) => e.event_name));
    // created_at (quando a aplicação armazenou) é distinto de occurred_at (quando ocorreu na fonte)
    assert.notEqual(new Date(events[0].occurred_at).getTime(), new Date(events[0].created_at).getTime());
    // pelo menos um evento tem complementos estruturados no event_metadata
    const withComplements = events.find((e) => e.event_metadata?.complements?.length > 0);
    assert.ok(withComplements);
    assert.equal(withComplements.event_metadata.complements[0].description, 'competência exclusiva');
  });

  it('3. segunda sync não duplica movimentações (idempotência preservada)', async () => {
    const session = await helper.registerAndLogin();
    const caseRow = await makeCase(session);
    const first = await syncCase(session.orgId, caseRow.id, session.userId, undefined, fakeLookupFull());
    assert.equal(first.inserted, 43);
    const second = await syncCase(session.orgId, caseRow.id, session.userId, undefined, fakeLookupFull());
    assert.equal(second.inserted, 0);
    assert.equal(second.duplicates, 43);
  });

  it('4. area permanece área jurídica (não recebe sistema processual)', async () => {
    const session = await helper.registerAndLogin();
    const caseRow = await makeCase(session);
    await syncCase(session.orgId, caseRow.id, session.userId, undefined, fakeLookupFull());
    const pool = getPool();
    const row = (await pool.query('SELECT area, judicial_system FROM cases WHERE id = $1', [caseRow.id])).rows[0];
    assert.equal(row.area, null);
    assert.equal(row.judicial_system, 'PJe');
  });
});
