import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb } from './helpers';
import { setCaptureAdaptersForTests } from '../src/capture/registry';
import type { CaptureAdapter, CapturedPublication } from '../src/capture/types';

class FakeCaptureAdapter implements CaptureAdapter {
  readonly name = 'PJE' as const;
  isConfigured(_config: Record<string, unknown> | null): boolean { return true; }
  async fetch(_config: Record<string, unknown>): Promise<CapturedPublication[]> {
    return [{
      processNumber: '1234-56.2024.8.01.0001',
      source: 'PJE',
      content: 'Intimação capturada via adapter fake',
      externalReference: 'ext-001',
      publicationDate: new Date().toISOString(),
    }];
  }
}

describe('Captura de publicações', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { setCaptureAdaptersForTests(null); const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  it('status retorna adapter não configurado por padrão', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app).get('/api/capture/status').set('Cookie', session.cookie).expect(200);
    assert.ok(Array.isArray(res.body.adapters));
    assert.ok(res.body.adapters.every((a: { configured: boolean }) => !a.configured));
  });

  it('run com adapter configurado captura e insere intimação', async () => {
    setCaptureAdaptersForTests([new FakeCaptureAdapter()]);
    const session = await helper.registerAndLogin();
    await request(app)
      .post('/api/processes')
      .set('Cookie', session.cookie)
      .send({ title: 'Proc Captura', processNumber: '1234-56.2024.8.01.0001' })
      .expect(201);

    const res = await request(app).post('/api/capture/run').set('Cookie', session.cookie).send({ adapters: ['PJE'] }).expect(200);
    assert.equal(res.body.totalCreated, 1);
    assert.equal(res.body.totalSkipped, 0);

    const pubs = await request(app).get('/api/publications').set('Cookie', session.cookie).expect(200);
    assert.equal(pubs.body.items.length, 1);
    assert.equal(pubs.body.items[0].source, 'PJE');
  });

  it('run com adapter não configurado retorna NOT_CONFIGURED', async () => {
    setCaptureAdaptersForTests(null);
    const session = await helper.registerAndLogin();
    const res = await request(app).post('/api/capture/run').set('Cookie', session.cookie).expect(200);
    assert.ok(res.body.runs.every((r: { status: string }) => r.status === 'NOT_CONFIGURED'));
  });
});