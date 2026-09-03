import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PJeClient, type PJeTransport } from '../src/capture/pje/client';
import { PJeError, PJE_ERROR_CODES, toCaptureErrorCode } from '../src/capture/pje/errors';
import { normalizePJeProcess, parsePJeDate } from '../src/capture/pje/normalize';
import { PJeCaptureAdapter, lookupPJeProcess, DEFAULT_PJE_GATEWAY_URL, DEFAULT_PJE_SSO_URL } from '../src/capture/pje/adapter';
import type { PJeProcessoHeader } from '../src/capture/pje/types';

/**
 * Testes unitários da integração PJe.
 * Usam mock do transporte HTTP (apenas aqui nos testes — nunca em produção).
 * Nenhuma chamada real à API é feita; nenhuma credencial real é utilizada.
 */

const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';
const USERNAME = 'test-user';
const PASSWORD = 'test-pass';

function tokenTransport(): PJeTransport {
  return async (_url, init) => {
    if (_url === DEFAULT_PJE_SSO_URL) {
      return {
        status: 200,
        json: async () => ({ access_token: 'test-token', expires_in: 3600, token_type: 'Bearer' }),
        text: async () => '',
      };
    }
    return { status: 200, json: async () => ({}), text: async () => '' };
  };
}

function okTransport(processos?: PJeProcessoHeader[]): PJeTransport {
  return async (url, init) => {
    if (url === DEFAULT_PJE_SSO_URL) {
      return {
        status: 200,
        json: async () => ({ access_token: 'test-token', expires_in: 3600, token_type: 'Bearer' }),
        text: async () => '',
      };
    }
    if (url.includes('/movimentos')) {
      // Retorna movimentos do primeiro processo fornecido
      const movs = (processos && processos[0]?.movimentos) ?? [];
      return {
        status: 200,
        json: async () => ({ _embedded: { movimentos: movs } }),
        text: async () => '',
      };
    }
    // Lookup de processos
    return {
      status: 200,
      json: async () => ({
        _embedded: { processos: processos ?? [] },
        content: processos ?? [],
        totalElements: processos?.length ?? 0,
      }),
      text: async () => '',
    };
  };
}

function transportWithStatus(status: number): PJeTransport {
  return async (url) => {
    if (url === DEFAULT_PJE_SSO_URL) {
      return {
        status: 200,
        json: async () => ({ access_token: 'test-token', expires_in: 3600, token_type: 'Bearer' }),
        text: async () => '',
      };
    }
    return { status, json: async () => ({}), text: async () => '' };
  };
}

function authFailTransport(): PJeTransport {
  return async (url) => {
    if (url === DEFAULT_PJE_SSO_URL) {
      return { status: 401, json: async () => ({ error: 'invalid_client' }), text: async () => 'Auth failed' };
    }
    return { status: 200, json: async () => ({}), text: async () => '' };
  };
}

const CONFIG = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, username: USERNAME, password: PASSWORD, tokenUrl: DEFAULT_PJE_SSO_URL, baseUrl: DEFAULT_PJE_GATEWAY_URL, timeoutMs: 5000 };

describe('PJe — erros e códigos', () => {
  it('PJeError não carrega segredo em nenhuma propriedade', () => {
    const err = new PJeError(PJE_ERROR_CODES.AUTH_FAILED);
    assert.ok(!err.message.includes(CLIENT_ID));
    assert.ok(!err.message.includes(CLIENT_SECRET));
    assert.ok(!err.message.includes(PASSWORD));
    assert.equal(err.code, PJE_ERROR_CODES.AUTH_FAILED);
  });

  it('toCaptureErrorCode mapeia corretamente', () => {
    assert.equal(toCaptureErrorCode(PJE_ERROR_CODES.AUTH_FAILED), 'AUTHENTICATION_FAILED');
    assert.equal(toCaptureErrorCode(PJE_ERROR_CODES.TIMEOUT), 'TIMEOUT');
    assert.equal(toCaptureErrorCode(PJE_ERROR_CODES.RATE_LIMITED), 'RATE_LIMITED');
    assert.equal(toCaptureErrorCode(PJE_ERROR_CODES.UNAVAILABLE), 'SOURCE_UNAVAILABLE');
    assert.equal(toCaptureErrorCode(PJE_ERROR_CODES.PROCESS_NOT_FOUND), 'INVALID_CONFIGURATION');
  });
});

describe('PJe — normalização', () => {
  const PROC: PJeProcessoHeader = {
    id: '12345',
    numeroProcesso: '00008323520184013202',
    tribunal: 'TRF1',
    grau: 'JE',
    nivelSigilo: 'PUBLICO',
    classe: { codigo: 436, nome: 'Procedimento do Juizado Especial Cível' },
    orgaoJulgador: { codigo: 16403, nome: 'Tefé' },
    dataAjuizamento: '2018-10-29T00:00:00.000Z',
    dataHoraUltimaAtualizacao: '2026-06-08T14:55:23.378Z',
    movimentos: [
      { id: 101, dataHora: '2018-10-30T14:06:24.000Z', tipoMovimento: { codigo: 26, nome: 'Distribuição' }, complementosTabelados: [{ codigo: 2, descricao: 'competência exclusiva' }] },
      { id: 102, dataHora: '2018-10-31T09:00:00.000Z', tipoMovimento: { codigo: 27, nome: 'Autos conclusos' } },
    ],
    partes: [
      { nome: 'João Silva', papel: { codigo: 1, nome: 'Réu' } },
      { nome: 'Maria Souza', papel: { codigo: 2, nome: 'Autor' } },
    ],
  };

  it('normaliza processo (número mascarado, tribunal, classe)', () => {
    const { process, movements } = normalizePJeProcess(PROC);
    assert.equal(process.processNumber, '0000832-35.2018.4.01.3202');
    assert.equal(process.court, 'TRF1');
    assert.ok(process.title!.includes('Procedimento do Juizado Especial Cível'));
    assert.ok(process.parties?.includes('João Silva'));
    assert.equal(movements.length, 2);
  });

  it('descrição de movimento inclui complementos tabelados', () => {
    const { movements } = normalizePJeProcess(PROC);
    assert.ok(movements[0]!.description.includes('competência exclusiva'));
    assert.ok(movements[0]!.description.includes('Distribuição'));
  });

  it('movimentações possuem referência determinística (base para dedup)', () => {
    const a = normalizePJeProcess(PROC).movements;
    const b = normalizePJeProcess(PROC).movements;
    assert.equal(a[0]!.sourceReference, b[0]!.sourceReference);
    assert.ok(a[0]!.sourceReference!.startsWith('pje-mov-'));
  });

  it('partes são preservadas como lista de nomes', () => {
    const { process } = normalizePJeProcess(PROC);
    const partes = process.parties;
    assert.ok(partes?.includes('Maria Souza'));
  });

  it('processo sem movimentos é aceito', () => {
    const { movements } = normalizePJeProcess({ id: '1', numeroProcesso: '00008323520184013202' });
    assert.equal(movements.length, 0);
  });

  it('metadados não incluem payload inteiro indiscriminadamente', () => {
    const { metadata } = normalizePJeProcess(PROC);
    const pje = metadata.pje as Record<string, unknown>;
    assert.ok(pje.tribunal === 'TRF1');
    assert.equal(pje.movementCount, 2);
  });
});

describe('PJe — datas', () => {
  it('ISO 8601', () => {
    const d = parsePJeDate('2026-06-08T14:55:23.378Z');
    assert.equal(d, '2026-06-08T14:55:23.378Z');
  });

  it('epoch ms', () => {
    const ms = Date.UTC(2020, 0, 15, 10, 30, 0);
    const d = parsePJeDate(ms);
    assert.equal(d, new Date(ms).toISOString());
  });

  it('null/undefined retorna null', () => {
    assert.equal(parsePJeDate(null), null);
    assert.equal(parsePJeDate(undefined), null);
  });
});

describe('PJeClient — HTTP e erros seguros', () => {
  const opts = (transport: PJeTransport) => ({ ...CONFIG, transport });

  it('configuração ausente lança NOT_CONFIGURED', () => {
    assert.throws(
      () => new PJeClient({ ...CONFIG, clientId: '', clientSecret: '', username: '', password: '' }),
      (e: PJeError) => e.code === PJE_ERROR_CODES.NOT_CONFIGURED,
    );
  });

  it('autenticação falha → AUTH_FAILED, mensagem não contém segredo', async () => {
    const client = new PJeClient(opts(authFailTransport()));
    try {
      await client.lookupByProcessNumber('0000832-35.2018.4.01.3202');
      assert.fail('deveria lançar');
    } catch (e) {
      assert.ok(e instanceof PJeError);
      assert.equal((e as PJeError).code, PJE_ERROR_CODES.AUTH_FAILED);
      assert.ok(!(e as PJeError).message.includes(CLIENT_SECRET));
    }
  });

  it('HTTP 401 → AUTH_FAILED (token expirado)', async () => {
    const client = new PJeClient(opts(transportWithStatus(401)));
    await assert.rejects(
      () => client.lookupByProcessNumber('0000832-35.2018.4.01.3202'),
      (e: PJeError) => e.code === PJE_ERROR_CODES.AUTH_FAILED,
    );
  });

  it('HTTP 429 → RATE_LIMITED', async () => {
    const client = new PJeClient(opts(transportWithStatus(429)));
    await assert.rejects(
      () => client.lookupByProcessNumber('0000832-35.2018.4.01.3202'),
      (e: PJeError) => e.code === PJE_ERROR_CODES.RATE_LIMITED,
    );
  });

  it('HTTP 404 → PROCESS_NOT_FOUND', async () => {
    const client = new PJeClient(opts(transportWithStatus(404)));
    await assert.rejects(
      () => client.lookupByProcessNumber('0000832-35.2018.4.01.3202'),
      (e: PJeError) => e.code === PJE_ERROR_CODES.PROCESS_NOT_FOUND,
    );
  });

  it('HTTP 504 → TIMEOUT', async () => {
    const client = new PJeClient(opts(transportWithStatus(504)));
    await assert.rejects(
      () => client.lookupByProcessNumber('0000832-35.2018.4.01.3202'),
      (e: PJeError) => e.code === PJE_ERROR_CODES.TIMEOUT,
    );
  });

  it('HTTP 503 → UNAVAILABLE', async () => {
    const client = new PJeClient(opts(transportWithStatus(503)));
    await assert.rejects(
      () => client.lookupByProcessNumber('0000832-35.2018.4.01.3202'),
      (e: PJeError) => e.code === PJE_ERROR_CODES.UNAVAILABLE,
    );
  });

  it('timeout (abort) → PJE_TIMEOUT', async () => {
    const abortTransport: PJeTransport = (_url, init) => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      init.signal.dispatchEvent(new Event('abort'));
      return Promise.reject(err);
    };
    const client = new PJeClient(opts(abortTransport));
    await assert.rejects(
      () => client.lookupByProcessNumber('0000832-35.2018.4.01.3202'),
      (e: PJeError) => e.code === PJE_ERROR_CODES.TIMEOUT,
    );
  });

  it('erro de rede (sem status) → NETWORK_ERROR', async () => {
    const netTransport: PJeTransport = async () => { throw new Error('ECONNREFUSED'); };
    const client = new PJeClient(opts(netTransport));
    await assert.rejects(
      () => client.lookupByProcessNumber('0000832-35.2018.4.01.3202'),
      (e: PJeError) => e.code === PJE_ERROR_CODES.NETWORK_ERROR,
    );
  });
});

describe('PJeAdapter — configuração, lookup e fetch', () => {
  it('isConfigured reflete presença de credenciais', () => {
    const adapter = new PJeCaptureAdapter();
    assert.equal(adapter.isConfigured(null), false);
    assert.equal(adapter.isConfigured({}), false);
    assert.equal(adapter.isConfigured(CONFIG), true);
  });

  it('testConnection sem credenciais → ok:false sem expor segredo', async () => {
    const adapter = new PJeCaptureAdapter();
    const r = await adapter.testConnection({});
    assert.equal(r.ok, false);
    assert.ok(!r.message.includes('Authorization'));
    assert.ok(!r.message.includes(CLIENT_SECRET));
  });

  it('testConnection com transporte OK → ok:true', async () => {
    const adapter = new PJeCaptureAdapter(okTransport([{ id: '1', numeroProcesso: '00008323520184013202' }]));
    const r = await adapter.testConnection(CONFIG);
    assert.equal(r.ok, true);
  });

  it('testConnection com 401 → ok:false, sem segredo na mensagem', async () => {
    const adapter = new PJeCaptureAdapter(authFailTransport());
    const r = await adapter.testConnection(CONFIG);
    assert.equal(r.ok, false);
    assert.ok(!r.message.includes(CLIENT_SECRET));
    assert.ok(!r.message.includes(PASSWORD));
  });

  it('lookupPJeProcess retorna documento normalizado (mock transport)', async () => {
    const doc = {
      id: '12345',
      numeroProcesso: '00008323520184013202',
      tribunal: 'TRF1',
      classe: { codigo: 436, nome: 'Procedimento do Juizado Especial Cível' },
      movimentos: [{ id: 101, dataHora: '2018-10-30T14:06:24.000Z', tipoMovimento: { codigo: 26, nome: 'Distribuição' } }],
    };
    const result = await lookupPJeProcess('0000832-35.2018.4.01.3202', CONFIG, okTransport([doc as PJeProcessoHeader]));
    assert.ok(result);
    assert.equal(result.process.processNumber, '0000832-35.2018.4.01.3202');
    assert.equal(result.process.court, 'TRF1');
    assert.equal(result.movements.length, 1);
  });

  it('lookupPJeProcess retorna null quando não encontrado', async () => {
    const result = await lookupPJeProcess('0000832-35.2018.4.01.3202', CONFIG, okTransport([]));
    assert.equal(result, null);
  });

  it('lookupPJeProcess sem credenciais → NOT_CONFIGURED', async () => {
    await assert.rejects(
      () => lookupPJeProcess('0000832-35.2018.4.01.3202', {}, okTransport([])),
      (e: PJeError) => e.code === PJE_ERROR_CODES.NOT_CONFIGURED,
    );
  });

  it('fetch consulta os números e retorna processos/movimentações', async () => {
    const doc = {
      id: '12345',
      numeroProcesso: '00008323520184013202',
      tribunal: 'TRF1',
      movimentos: [{ id: 101, dataHora: '2018-10-30T14:06:24.000Z', tipoMovimento: { codigo: 26, nome: 'Distribuição' } }],
    };
    const adapter = new PJeCaptureAdapter(okTransport([doc as PJeProcessoHeader]));
    const res = await adapter.fetch({ ...CONFIG, processNumbers: ['0000832-35.2018.4.01.3202'] });
    assert.equal(res.processes.length, 1);
    assert.equal(res.movements.length, 1);
    assert.equal(res.processes[0]!.processNumber, '0000832-35.2018.4.01.3202');
    assert.deepEqual(res.publications, []);
  });

  it('fetch sem processNumbers retorna vazio', async () => {
    const adapter = new PJeCaptureAdapter(okTransport([{ id: '1', numeroProcesso: 'x' }]));
    const res = await adapter.fetch(CONFIG);
    assert.deepEqual(res.processes, []);
    assert.deepEqual(res.movements, []);
  });

  it('fetch propaga erro sistêmico (401) — mensagem não contém segredo', async () => {
    const adapter = new PJeCaptureAdapter(transportWithStatus(401));
    await assert.rejects(
      () => adapter.fetch({ ...CONFIG, processNumbers: ['0000832-35.2018.4.01.3202'] }),
      (e: PJeError) => e.code === PJE_ERROR_CODES.AUTH_FAILED && !e.message.includes(CLIENT_SECRET),
    );
  });

  it('fetch sem credenciais lança NOT_CONFIGURED', async () => {
    const adapter = new PJeCaptureAdapter(okTransport([]));
    await assert.rejects(
      () => adapter.fetch({ processNumbers: ['0000832-35.2018.4.01.3202'] }),
      (e: PJeError) => e.code === PJE_ERROR_CODES.NOT_CONFIGURED,
    );
  });

  it('capabilities do provider de descoberta são honestas', async () => {
    const { PJeDiscoveryProvider } = await import('../src/capture/pje/adapter');
    const provider = new PJeDiscoveryProvider();
    const caps = provider.capabilities();
    assert.equal(caps.supportsProfessionalDiscovery, false);
    assert.equal(caps.supportsProcessLookup, true);
    assert.equal(caps.supportsMovements, true);
    assert.equal(caps.supportsDocuments, true);
    // discoverByProfessional retorna erro honesto
    const r = await provider.discoverByProfessional(
      { id: '1', professionalName: 'X', oabNumber: '1', oabState: 'SP' },
      null,
    );
    assert.equal(r.processes.length, 0);
    assert.ok(r.error?.message.includes('OAB'));
  });
});