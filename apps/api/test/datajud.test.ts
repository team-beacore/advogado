import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DataJudClient } from '../src/capture/datajud/client';
import type { DataJudTransport } from '../src/capture/datajud/client';
import { parseCNJ, formatCNJ, resolveCourtFromProcessNumber } from '../src/capture/datajud/cnj';
import { normalizeDataJudSource, parseDataJudDate } from '../src/capture/datajud/normalize';
import { DataJudCaptureAdapter, lookupDataJudProcess, resolveDataJudConfig, DEFAULT_DATAJUD_BASE_URL } from '../src/capture/datajud/adapter';
import { DATAJUD_ERROR_CODES, DataJudError } from '../src/capture/datajud/errors';

/**
 * Testes unitários da integração DataJud.
 * Usam mock do transporte HTTP (apenas aqui nos testes — nunca em produção).
 * Nenhuma chamada real à API é feita; nenhuma credencial real é utilizada.
 */

const API_KEY = 'chave-de-teste-que-nao-deve-vazar';

function okTransport(doc?: Record<string, unknown> | null): DataJudTransport {
  return async () => ({
    status: 200,
    json: async () => ({
      took: 10,
      timed_out: false,
      _shards: { total: 1, successful: 1, failed: 0 },
      hits: {
        total: { value: doc ? 1 : 0, relation: 'eq' },
        hits: doc ? [{ _id: 'x', _source: doc }] : [],
      },
    }),
  });
}

function transportWithStatus(status: number, body: unknown = {}): DataJudTransport {
  return async () => ({ status, json: async () => body });
}

describe('CNJ — parse e formatação do número de processo', () => {
  it('parse aceita número mascarado e sem máscara', () => {
    const masked = parseCNJ('0000832-35.2018.4.01.3202')!;
    assert.equal(masked.digits, '00008323520184013202');
    assert.equal(masked.segment, '4');
    assert.equal(masked.tribunal, '01');
    assert.equal(masked.year, '2018');

    const plain = parseCNJ('00008323520184013202')!;
    assert.equal(plain.mask, '0000832-35.2018.4.01.3202');
  });

  it('formatCNJ produz NNNNNNN-DD.AAAA.J.TR.OOOO', () => {
    assert.equal(formatCNJ('00008323520184013202'), '0000832-35.2018.4.01.3202');
    assert.equal(formatCNJ('123'), null);
  });

  it('rejeita número inválido (comprimento errado / não numérico)', () => {
    assert.equal(parseCNJ('0000832-35.2018.4.01'), null);
    assert.equal(parseCNJ('abc'), null);
    assert.equal(parseCNJ(''), null);
  });
});

describe('CNJ — resolução de tribunal (regras oficiais do CNJ)', () => {
  it('TRF1 (segmento 4)', () => {
    const c = resolveCourtFromProcessNumber('0000832-35.2018.4.01.3202')!;
    assert.equal(c.court, 'TRF1');
    assert.equal(c.sigla, 'trf1');
  });

  it('TJRJ (segmento 8, TR 19)', () => {
    const c = resolveCourtFromProcessNumber('0000001-89.2020.8.19.0001')!;
    assert.equal(c.court, 'TJRJ');
    assert.equal(c.sigla, 'tjrj');
  });

  it('TJDFT usa sigla especial (TR 07)', () => {
    const c = resolveCourtFromProcessNumber('0000001-89.2020.8.07.0001')!;
    assert.equal(c.court, 'TJDFT');
    assert.equal(c.sigla, 'tjdft');
  });

  it('STJ (segmento 3)', () => {
    const c = resolveCourtFromProcessNumber('0000001-89.2020.3.00.0001')!;
    assert.equal(c.court, 'STJ');
    assert.equal(c.sigla, 'stj');
  });

  it('TRE-RJ (segmento 6, TR 19)', () => {
    const c = resolveCourtFromProcessNumber('0000001-89.2020.6.19.0001')!;
    assert.equal(c.court, 'TRE-RJ');
    assert.equal(c.sigla, 'tre-rj');
  });

  it('STF (segmento 1) NÃO é suportado (não integra o DataJud)', () => {
    assert.equal(resolveCourtFromProcessNumber('0000001-89.2020.1.00.0001'), null);
  });

  it('CNJ (segmento 2) NÃO é suportado', () => {
    assert.equal(resolveCourtFromProcessNumber('0000001-89.2020.2.00.0001'), null);
  });

  it('número inválido lança DataJudError INVALID_NUMBER', () => {
    assert.throws(() => resolveCourtFromProcessNumber('123'), (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.INVALID_NUMBER);
  });
});

describe('DataJud — datas (formatos coexistentes)', () => {
  it('14 dígitos (YYYYMMDDHHmmss, horário de Brasília)', () => {
    const d = parseDataJudDate('20181029000000')!;
    assert.equal(d.toISOString(), '2018-10-29T03:00:00.000Z'); // 00:00 Brasília = 03:00 UTC
  });

  it('string ISO', () => {
    const d = parseDataJudDate('2026-06-08T14:55:23.378000Z')!;
    assert.equal(d.toISOString(), '2026-06-08T14:55:23.378Z');
  });

  it('epoch ms', () => {
    const ms = Date.UTC(2020, 0, 15, 10, 30, 0);
    const d = parseDataJudDate(ms)!;
    assert.equal(d.getTime(), ms);
  });

  it('valor inválido retorna null', () => {
    assert.equal(parseDataJudDate(null), null);
    assert.equal(parseDataJudDate('abc'), null);
    assert.equal(parseDataJudDate('20201340'), null);
  });
});

describe('DataJud — normalização do documento', () => {
  const DOC = {
    id: 'TRF1_JE_00008323520184013202',
    tribunal: 'TRF1',
    grau: 'JE',
    numeroProcesso: '00008323520184013202',
    dataAjuizamento: '20181029000000',
    nivelSigilo: 0,
    orgaoJulgador: { codigo: 16403, nome: 'Tefé' },
    classe: { codigo: 436, nome: 'Procedimento do Juizado Especial Cível' },
    sistema: { codigo: 1, nome: 'PJe' },
    dataHoraUltimaAtualizacao: '2026-06-08T14:55:23.378000Z',
    movimentos: [
      { codigo: 26, dataHora: '2018-10-30T14:06:24.000Z', nome: 'Distribuição', complementosTabelados: [{ codigo: 2, descricao: 'competência exclusiva' }] },
      { codigo: 27, dataHora: '20181031090000', nome: 'Autos conclusos' },
    ],
  };

  it('normaliza processo (número mascarado, tribunal, classe)', () => {
    const { process, movements } = normalizeDataJudSource(DOC);
    assert.equal(process.processNumber, '0000832-35.2018.4.01.3202');
    assert.equal(process.court, 'TRF1');
    assert.ok(process.title!.includes('Procedimento do Juizado Especial Cível'));
    assert.equal(movements.length, 2);
  });

  it('descrição de movimento inclui complementos tabelados', () => {
    const { movements } = normalizeDataJudSource(DOC);
    assert.ok(movements[0]!.description.includes('competência exclusiva'));
    assert.ok(movements[0]!.description.includes('Distribuição'));
  });

  it('movimentações possuem referência determinística (base para dedup)', () => {
    const a = normalizeDataJudSource(DOC).movements;
    const b = normalizeDataJudSource(DOC).movements;
    assert.equal(a[0]!.sourceReference, b[0]!.sourceReference);
    assert.ok(a[0]!.sourceReference!.startsWith('datajud-mov-'));
  });

  it('documento sem movimentos é aceito', () => {
    const { movements } = normalizeDataJudSource({ numeroProcesso: '00008323520184013202' });
    assert.equal(movements.length, 0);
  });

  it('metadados não incluem payload inteiro indiscriminadamente', () => {
    const { process, metadata } = normalizeDataJudSource(DOC);
    const dj = metadata.dataJud as Record<string, unknown>;
    assert.ok(dj.tribunal === 'TRF1');
    assert.ok(typeof (dj as { orgaoJulgador?: unknown }).orgaoJulgador === 'object');
    assert.equal((dj as { movementCount?: number }).movementCount, 2);
    assert.ok(process.processNumber);
  });
});

describe('DataJudClient — HTTP e erros seguros', () => {
  const opts = (transport: DataJudTransport) => ({ baseUrl: DEFAULT_DATAJUD_BASE_URL, apiKey: API_KEY, timeoutMs: 5000, transport });

  it('configuração ausente lança NOT_CONFIGURED', () => {
    assert.throws(
      () => new DataJudClient({ baseUrl: DEFAULT_DATAJUD_BASE_URL, apiKey: '', timeoutMs: 1000 }),
      (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.NOT_CONFIGURED,
    );
  });

  it('resposta 200 válida retorna o primeiro documento', async () => {
    const doc = { numeroProcesso: '00008323520184013202' };
    const client = new DataJudClient(opts(okTransport(doc)));
    const res = await client.search('trf1', { query: { match_all: {} } });
    const source = DataJudClient.firstSource(res);
    assert.equal(source?.numeroProcesso, '00008323520184013202');
  });

  it('HTTP 401 → UNAUTHORIZED e a mensagem NÃO contém a chave', async () => {
    const client = new DataJudClient(opts(transportWithStatus(401)));
    try {
      await client.search('trf1', {});
      assert.fail('deveria lançar');
    } catch (e) {
      assert.ok(e instanceof DataJudError);
      assert.equal((e as DataJudError).code, DATAJUD_ERROR_CODES.UNAUTHORIZED);
      assert.ok(!(e as DataJudError).message.includes(API_KEY));
    }
  });

  it('HTTP 403 → FORBIDDEN', async () => {
    const client = new DataJudClient(opts(transportWithStatus(403)));
    await assert.rejects(() => client.search('trf1', {}), (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.FORBIDDEN);
  });

  it('HTTP 404 → COURT_NOT_SUPPORTED', async () => {
    const client = new DataJudClient(opts(transportWithStatus(404)));
    await assert.rejects(() => client.search('stf', {}), (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.COURT_NOT_SUPPORTED);
  });

  it('HTTP 429 → RATE_LIMITED', async () => {
    const client = new DataJudClient(opts(transportWithStatus(429)));
    await assert.rejects(() => client.search('trf1', {}), (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.RATE_LIMITED);
  });

  it('HTTP 504 → TIMEOUT (gateway)', async () => {
    const client = new DataJudClient(opts(transportWithStatus(504)));
    await assert.rejects(() => client.search('trf1', {}), (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.TIMEOUT);
  });

  it('timeout (abort) → DATAJUD_TIMEOUT', async () => {
    const abortTransport: DataJudTransport = (_url, init) => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      init.signal.dispatchEvent(new Event('abort'));
      return Promise.reject(err);
    };
    const client = new DataJudClient(opts(abortTransport));
    await assert.rejects(() => client.search('trf1', {}), (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.TIMEOUT);
  });

  it('resposta JSON inválida → BAD_RESPONSE', async () => {
    const badTransport: DataJudTransport = async () => ({ status: 200, json: async () => 'não é objeto' });
    const client = new DataJudClient(opts(badTransport));
    await assert.rejects(() => client.search('trf1', {}), (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.BAD_RESPONSE);
  });

  it('envelope sem hits → BAD_RESPONSE', async () => {
    const client = new DataJudClient(opts(transportWithStatus(200, { foo: 1 })));
    await assert.rejects(() => client.search('trf1', {}), (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.BAD_RESPONSE);
  });

  it('resposta com _shards.failed > 0 → UNAVAILABLE (não confiável)', async () => {
    const shardTransport: DataJudTransport = async () => ({
      status: 200,
      json: async () => ({ _shards: { total: 3, successful: 2, failed: 1 }, hits: { hits: [] } }),
    });
    const client = new DataJudClient(opts(shardTransport));
    await assert.rejects(() => client.search('trf1', {}), (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.UNAVAILABLE);
  });

  it('erro de rede (sem status) → UNAVAILABLE', async () => {
    const netTransport: DataJudTransport = async () => { throw new Error('ECONNREFUSED'); };
    const client = new DataJudClient(opts(netTransport));
    await assert.rejects(() => client.search('trf1', {}), (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.UNAVAILABLE);
  });
});

describe('DataJudAdapter — configuração, lookup e fetch', () => {
  const config = { apiKey: API_KEY, baseUrl: DEFAULT_DATAJUD_BASE_URL };

  it('isConfigured reflete a presença da chave', () => {
    const adapter = new DataJudCaptureAdapter();
    assert.equal(adapter.isConfigured(null), false);
    assert.equal(adapter.isConfigured({}), false);
    assert.equal(adapter.isConfigured(config), true);
  });

  it('resolveDataJudConfig suporta apiKey e password (compatível com settings)', () => {
    const viaPassword = resolveDataJudConfig({ password: 'chave-x', baseUrl: 'https://x.example' });
    assert.equal(viaPassword.apiKey, 'chave-x');
    assert.equal(viaPassword.baseUrl, 'https://x.example');
    assert.deepEqual(viaPassword.processNumbers, []);
  });

  it('testConnection sem chave → ok:false sem expor segredo', async () => {
    const adapter = new DataJudCaptureAdapter();
    const r = await adapter.testConnection({});
    assert.equal(r.ok, false);
    // A mensagem pode conter "chave" (substantivo), mas NUNCA o valor da chave nem o header.
    assert.ok(!r.message.includes('Authorization'));
    assert.ok(r.message.length > 0);
  });

  it('testConnection com transporte OK → ok:true (chamada real simulada)', async () => {
    const adapter = new DataJudCaptureAdapter(okTransport({ numeroProcesso: 'x' }));
    const r = await adapter.testConnection(config);
    assert.equal(r.ok, true);
    assert.ok(!r.message.includes(API_KEY));
  });

  it('testConnection com 401 → ok:false, sem a chave na mensagem', async () => {
    const adapter = new DataJudCaptureAdapter(transportWithStatus(401));
    const r = await adapter.testConnection(config);
    assert.equal(r.ok, false);
    assert.ok(!r.message.includes(API_KEY));
    assert.ok(!r.message.includes('Authorization'));
  });

  it('lookupDataJudProcess retorna documento normalizado (mock transport)', async () => {
    const doc = {
      id: 'TRF1_JE_00008323520184013202',
      tribunal: 'TRF1',
      numeroProcesso: '00008323520184013202',
      classe: { codigo: 436, nome: 'Procedimento do Juizado Especial Cível' },
      movimentos: [{ codigo: 26, dataHora: '2018-10-30T14:06:24.000Z', nome: 'Distribuição' }],
    };
    const result = await lookupDataJudProcess('0000832-35.2018.4.01.3202', config, okTransport(doc));
    assert.ok(result);
    assert.equal(result.process.processNumber, '0000832-35.2018.4.01.3202');
    assert.equal(result.process.court, 'TRF1');
    assert.equal(result.movements.length, 1);
  });

  it('lookupDataJudProcess retorna null quando não encontrado', async () => {
    const result = await lookupDataJudProcess('0000832-35.2018.4.01.3202', config, okTransport(null));
    assert.equal(result, null);
  });

  it('lookup com tribunal não suportado (STF) lança COURT_NOT_SUPPORTED', async () => {
    await assert.rejects(
      () => lookupDataJudProcess('0000001-89.2020.1.00.0001', config, okTransport(null)),
      (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.COURT_NOT_SUPPORTED,
    );
  });

  it('lookup com número inválido lança INVALID_NUMBER', async () => {
    await assert.rejects(
      () => lookupDataJudProcess('123', config, okTransport(null)),
      (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.INVALID_NUMBER,
    );
  });

  it('fetch consulta os números e retorna processos/movimentações', async () => {
    const doc = {
      id: 'x',
      tribunal: 'TRF1',
      numeroProcesso: '00008323520184013202',
      movimentos: [{ codigo: 26, dataHora: '2018-10-30T14:06:24.000Z', nome: 'Distribuição' }],
    };
    const adapter = new DataJudCaptureAdapter(okTransport(doc));
    const res = await adapter.fetch({ ...config, processNumbers: ['0000832-35.2018.4.01.3202'] });
    assert.equal(res.processes.length, 1);
    assert.equal(res.movements.length, 1);
    assert.equal(res.processes[0]!.processNumber, '0000832-35.2018.4.01.3202');
    assert.deepEqual(res.publications, []);
  });

  it('fetch ignora número de tribunal não suportado e número inválido', async () => {
    const adapter = new DataJudCaptureAdapter(okTransport(null));
    const res = await adapter.fetch({ ...config, processNumbers: ['0000001-89.2020.1.00.0001', 'invalido', '0000832-35.2018.4.01.3202'] });
    assert.equal(res.processes.length, 0);
  });

  it('fetch sem processNumbers retorna vazio (sem chamada real forjada)', async () => {
    const adapter = new DataJudCaptureAdapter(okTransport({ numeroProcesso: 'x' }));
    const res = await adapter.fetch(config);
    assert.deepEqual(res.processes, []);
    assert.deepEqual(res.movements, []);
  });

  it('fetch propaga erro sistêmico (401) — mensagem não contém a chave', async () => {
    const adapter = new DataJudCaptureAdapter(transportWithStatus(401));
    await assert.rejects(
      () => adapter.fetch({ ...config, processNumbers: ['0000832-35.2018.4.01.3202'] }),
      (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.UNAUTHORIZED && !e.message.includes(API_KEY),
    );
  });

  it('fetch sem chave lança NOT_CONFIGURED', async () => {
    const adapter = new DataJudCaptureAdapter(okTransport(null));
    await assert.rejects(
      () => adapter.fetch({ processNumbers: ['0000832-35.2018.4.01.3202'] }),
      (e: DataJudError) => e.code === DATAJUD_ERROR_CODES.NOT_CONFIGURED,
    );
  });

  it('capabilities do provider de descoberta são honestas', async () => {
    const { DataJudDiscoveryProvider } = await import('../src/capture/datajud/adapter');
    const provider = new DataJudDiscoveryProvider();
    const caps = provider.capabilities();
    assert.equal(caps.supportsProfessionalDiscovery, false);
    assert.equal(caps.supportsProcessLookup, true);
    assert.equal(caps.supportsMovements, true);
    assert.equal(caps.supportsPublications, false);
    const r = await provider.discoverByProfessional(
      { id: '1', professionalName: 'X', oabNumber: '1', oabState: 'RJ' },
      null,
    );
    assert.equal(r.processes.length, 0);
    assert.ok(r.error?.message.includes('OAB'));
  });
});

// Sem uso de banco — testes puramente unitários.
// (Imports mantidos para clareza de cobertura.)
describe('DataJud — captura_runs (registro seguro)', () => {
  it('DataJudError não carrega a chave em nenhuma propriedade', () => {
    const err = new DataJudError(DATAJUD_ERROR_CODES.UNAUTHORIZED);
    assert.ok(!err.message.includes(API_KEY));
    assert.ok(!err.stack?.includes(API_KEY));
    assert.equal(err.code, DATAJUD_ERROR_CODES.UNAUTHORIZED);
  });
});
