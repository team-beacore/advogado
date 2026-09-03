import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DJENClient, DJENError, DJEN_ERROR_CODES, DEFAULT_DJEN_BASE_URL } from '../src/capture/djen/client';
import type { DJENTransport } from '../src/capture/djen/client';

/**
 * ETAPA 13 — Testes unitários do client DJEN (transporte mock — permitido em teste unitário).
 * Cobrem: resposta válida, vazia, inválida, erro HTTP, timeout, resposta parcial, URL correta.
 * A VALIDAÇÃO REAL (HTTP real) é feita por script dedicado, não aqui.
 */

function httpOk(body: unknown, status = 200): DJENTransport {
  return async () => ({ status, headers: { get: () => null }, json: async () => body });
}

function httpError(name: string, message: string): DJENTransport {
  return async (_url, init) => {
    const err = new Error(message);
    err.name = name;
    init.signal.dispatchEvent(new Event('abort'));
    return Promise.reject(err);
  };
}

function captureUrl(): { transport: DJENTransport; urls: string[] } {
  const urls: string[] = [];
  const transport: DJENTransport = async (url) => {
    urls.push(url);
    return { status: 200, headers: { get: () => null }, json: async () => ({ status: 'success', count: 0, items: [] }) };
  };
  return { transport, urls };
}

const opts = (transport: DJENTransport, baseUrl = DEFAULT_DJEN_BASE_URL) => ({ baseUrl, timeoutMs: 5000, transport });

describe('DJENClient — URL e parâmetros (caminho real correto)', () => {
  it('findByOab monta URL absoluta com numeroOab/ufOab/itensPorPagina', async () => {
    const { transport, urls } = captureUrl();
    const client = new DJENClient(opts(transport));
    await client.findByOab('123456', 'RJ');
    const url = urls[0]!;
    assert.ok(url.startsWith(DEFAULT_DJEN_BASE_URL + '/api/v1/comunicacao?'));
    assert.ok(url.includes('numeroOab=123456'));
    assert.ok(url.includes('ufOab=RJ'));
    assert.ok(url.includes('itensPorPagina=100'));
  });

  it('findByProcessNumber monta URL absoluta com numeroProcesso', async () => {
    const { transport, urls } = captureUrl();
    const client = new DJENClient(opts(transport));
    await client.findByProcessNumber('00008323520184013202');
    assert.ok(urls[0]!.includes('numeroProcesso=00008323520184013202'));
  });

  it('listTribunals usa URL absoluta (regressão do bug de caminho relativo)', async () => {
    const urls: string[] = [];
    const tribunalsOk: DJENTransport = async (url) => {
      urls.push(url);
      return { status: 200, headers: { get: () => null }, json: async () => [{ sigla: 'TRF1', nome: 'Tribunal', jurisdicao: 'federal' }] };
    };
    const client = new DJENClient(opts(tribunalsOk));
    await client.listTribunals();
    assert.equal(urls[0], DEFAULT_DJEN_BASE_URL + '/api/v1/comunicacao/tribunal');
  });
});

describe('DJENClient — respostas', () => {
  it('resposta válida retorna itens e count', async () => {
    const body = { status: 'success', count: 1, items: [{ id: 1, numero_processo: '00008323520184013202' }] };
    const client = new DJENClient(opts(httpOk(body)));
    const res = await client.findByOab('123456', 'RJ');
    assert.equal(res.count, 1);
    assert.equal(res.items?.length, 1);
  });

  it('resposta vazia (0 itens) é aceita sem erro', async () => {
    const client = new DJENClient(opts(httpOk({ status: 'success', count: 0, items: [] })));
    const res = await client.findByOab('123456', 'RJ');
    assert.equal(res.items?.length, 0);
  });

  it('resposta inválida (sem array items) → DJEN_BAD_RESPONSE', async () => {
    const client = new DJENClient(opts(httpOk({ foo: 1 })));
    await assert.rejects(() => client.findByOab('123456', 'RJ'), (e: DJENError) => e.code === DJEN_ERROR_CODES.BAD_RESPONSE);
  });

  it('HTTP 429 → DJEN_RATE_LIMITED', async () => {
    const client = new DJENClient(opts(httpOk({}, 429)));
    await assert.rejects(() => client.findByOab('123456', 'RJ'), (e: DJENError) => e.code === DJEN_ERROR_CODES.RATE_LIMITED);
  });

  it('HTTP 422 → DJEN_INVALID_PARAMS', async () => {
    const client = new DJENClient(opts(httpOk({}, 422)));
    await assert.rejects(() => client.findByOab('123456', 'RJ'), (e: DJENError) => e.code === DJEN_ERROR_CODES.INVALID_PARAMS);
  });

  it('HTTP 500 → DJEN_UNAVAILABLE', async () => {
    const client = new DJENClient(opts(httpOk({}, 500)));
    await assert.rejects(() => client.findByOab('123456', 'RJ'), (e: DJENError) => e.code === DJEN_ERROR_CODES.UNAVAILABLE);
  });

  it('timeout (abort) → DJEN_UNAVAILABLE com mensagem de tempo limite', async () => {
    const client = new DJENClient(opts(httpError('AbortError', 'aborted')));
    await assert.rejects(() => client.findByOab('123456', 'RJ'), (e: DJENError) => e.code === DJEN_ERROR_CODES.UNAVAILABLE && e.message.includes('Tempo limite'));
  });

  it('erro de rede genérico → DJEN_UNAVAILABLE', async () => {
    const net: DJENTransport = async () => { throw new Error('ECONNREFUSED'); };
    const client = new DJENClient(opts(net));
    await assert.rejects(() => client.findByOab('123456', 'RJ'), (e: DJENError) => e.code === DJEN_ERROR_CODES.UNAVAILABLE);
  });
});

describe('DJENClient — resposta parcial e dados incompletos', () => {
  it('itens com campos ausentes são aceitos (provider decide o que descartar)', async () => {
    const body = {
      status: 'success',
      count: 2,
      items: [
        { id: 1, numero_processo: '00008323520184013202', siglaTribunal: 'TRF1' },
        { id: 2 }, // sem numero_processo — client não quebra
      ],
    };
    const client = new DJENClient(opts(httpOk(body)));
    const res = await client.findByOab('123456', 'RJ');
    assert.equal(res.items?.length, 2);
  });

  it('listTribunals aceita array válido e rejeita não-array', async () => {
    const ok = new DJENClient(opts(httpOk([{ sigla: 'TRF1' }])));
    const tribunals = await ok.listTribunals();
    assert.ok(Array.isArray(tribunals));
    const bad = new DJENClient(opts(httpOk({ not: 'array' })));
    await assert.rejects(() => bad.listTribunals(), (e: DJENError) => e.code === DJEN_ERROR_CODES.BAD_RESPONSE);
  });
});
