import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb } from './helpers';
import { setCaptureAdaptersForTests } from '../src/capture/registry';
import type { CaptureAdapter, CaptureFetchResult, CaptureTestResult } from '../src/capture/types';

class FakeCaptureAdapter implements CaptureAdapter {
  readonly source = 'PJE' as const;
  readonly mode = 'AUTHENTICATED' as const;
  readonly label = 'PJe (fake de teste)';
  readonly implemented = true;
  isConfigured(_config: Record<string, unknown> | null): boolean { return true; }
  async testConnection(_config: Record<string, unknown>): Promise<CaptureTestResult> {
    return { ok: true, message: 'ok' };
  }
  async fetch(_config: Record<string, unknown>): Promise<CaptureFetchResult> {
    return {
      processes: [{ processNumber: '1234-56.2024.8.01.0001', title: 'Proc Fake' }],
      movements: [{ processNumber: '1234-56.2024.8.01.0001', date: new Date().toISOString(), description: 'Movimento fake', sourceReference: 'ext-mov-001' }],
      publications: [{
        processNumber: '1234-56.2024.8.01.0001',
        content: 'Intimação capturada via adapter fake',
        externalReference: 'ext-001',
        publicationDate: new Date().toISOString(),
      }],
    };
  }
}

describe('Captura de publicações', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { setCaptureAdaptersForTests(null); const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  it('status retorna fontes com estado honesto (DEMO implementada, tribunais não implementados)', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app).get('/api/capture/status').set('Cookie', session.cookie).expect(200);
    assert.ok(Array.isArray(res.body.adapters));
    const demo = res.body.adapters.find((a: { source: string }) => a.source === 'DEMO');
    assert.ok(demo);
    assert.equal(demo.implemented, true);
    const pje = res.body.adapters.find((a: { source: string }) => a.source === 'PJE');
    assert.equal(pje.implemented, false);
  });

  it('run DEMO cria processos, movimentações e publicações idempotentemente', async () => {
    const session = await helper.registerAndLogin();
    const first = await request(app).post('/api/capture/run').set('Cookie', session.cookie).send({ source: 'DEMO' }).expect(200);
    assert.equal(first.body.status, 'SUCCESS');
    assert.equal(first.body.processesFound, 3);
    assert.equal(first.body.publicationsFound, 5);
    assert.equal(first.body.imported, 26); // 3 processos + 18 movimentações + 5 publicações

    const pubs = await request(app).get('/api/publications').set('Cookie', session.cookie).expect(200);
    assert.equal(pubs.body.items.length, 5);
    assert.ok(pubs.body.items.every((p: { source: string }) => p.source === 'DEMO'));

    // Segunda execução → nenhuma duplicação
    const second = await request(app).post('/api/capture/run').set('Cookie', session.cookie).send({ source: 'DEMO' }).expect(200);
    assert.equal(second.body.status, 'SUCCESS');
    assert.equal(second.body.duplicate, 26);
    assert.equal(second.body.imported, 0);
    const pubs2 = await request(app).get('/api/publications').set('Cookie', session.cookie).expect(200);
    assert.equal(pubs2.body.items.length, 5);
  });

  it('run com adapter fake configurado captura e insere publicação', async () => {
    setCaptureAdaptersForTests([new FakeCaptureAdapter()]);
    const session = await helper.registerAndLogin();
    const res = await request(app).post('/api/capture/run').set('Cookie', session.cookie).send({ source: 'PJE' }).expect(200);
    assert.equal(res.body.status, 'SUCCESS');
    const pubs = await request(app).get('/api/publications').set('Cookie', session.cookie).expect(200);
    assert.equal(pubs.body.items.length, 1);
    assert.equal(pubs.body.items[0].source, 'PJE');
  });

  it('run em fonte não implementada retorna FAILED honesto (sem fingir conexão)', async () => {
    setCaptureAdaptersForTests(null);
    const session = await helper.registerAndLogin();
    const res = await request(app).post('/api/capture/run').set('Cookie', session.cookie).send({ source: 'PJE' }).expect(200);
    assert.equal(res.body.status, 'FAILED');
    assert.ok(res.body.errorMessage.includes('não implementada'));
  });

  it('test de conexão DEMO retorna ok', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app).post('/api/capture/test').set('Cookie', session.cookie).send({ source: 'DEMO' }).expect(200);
    assert.equal(res.body.ok, true);
  });
});
