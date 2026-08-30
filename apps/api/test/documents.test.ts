import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb } from './helpers';

describe('Documents', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  async function createCase(session: { cookie: string }) {
    const res = await request(app)
      .post('/api/processes')
      .set('Cookie', session.cookie)
      .send({ title: 'Proc Doc', processNumber: '1111-11.2024.8.01.0001' })
      .expect(201);
    return res.body;
  }

  it('uploads a document to a process', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .attach('file', Buffer.from('PDF content'), { filename: 'peticao.pdf', contentType: 'application/pdf' })
      .field('processId', proc.id)
      .field('name', 'Petição Inicial')
      .expect(201);
    assert.equal(res.body.name, 'Petição Inicial');
    assert.equal(res.body.mime_type, 'application/pdf');
    assert.ok(res.body.hash);
    assert.equal(res.body.organization_id, session.orgId);
  });

  it('rejects unsupported MIME type', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .attach('file', Buffer.from('not an image'), { filename: 'virus.exe', contentType: 'application/x-msdownload' })
      .field('processId', proc.id)
      .expect(415);
    assert.equal(res.body.code, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('lists documents for a process', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    await request(app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .attach('file', Buffer.from('doc1'), { filename: 'doc1.pdf', contentType: 'application/pdf' })
      .field('processId', proc.id)
      .expect(201);
    await request(app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .attach('file', Buffer.from('doc2'), { filename: 'doc2.pdf', contentType: 'application/pdf' })
      .field('processId', proc.id)
      .expect(201);

    const list = await request(app).get(`/api/documents?processId=${proc.id}`).set('Cookie', session.cookie).expect(200);
    assert.equal(list.body.items.length, 2);
  });

  it('downloads a document', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    const upload = await request(app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .attach('file', Buffer.from('conteúdo do documento'), { filename: 'contrato.pdf', contentType: 'application/pdf' })
      .field('processId', proc.id)
      .expect(201);
    const download = await request(app)
      .get(`/api/documents/${upload.body.id}/download`)
      .set('Cookie', session.cookie)
      .expect(200);
    assert.equal(download.body.toString('utf8'), 'conteúdo do documento');
    assert.equal(download.headers['content-type'], 'application/pdf');
  });

  it('cannot download document from another org', async () => {
    const a = await helper.registerAndLogin();
    const b = await helper.registerAndLogin();
    const proc = await createCase(a);
    const upload = await request(app)
      .post('/api/documents')
      .set('Cookie', a.cookie)
      .attach('file', Buffer.from('secret'), { filename: 'segredo.pdf', contentType: 'application/pdf' })
      .field('processId', proc.id)
      .expect(201);
    await request(app).get(`/api/documents/${upload.body.id}/download`).set('Cookie', b.cookie).expect(404);
  });

  it('deletes a document (soft delete)', async () => {
    const session = await helper.registerAndLogin();
    const proc = await createCase(session);
    const upload = await request(app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .attach('file', Buffer.from('to delete'), { filename: 'del.pdf', contentType: 'application/pdf' })
      .field('processId', proc.id)
      .expect(201);
    await request(app).delete(`/api/documents/${upload.body.id}`).set('Cookie', session.cookie).expect(200);
    await request(app).get(`/api/documents/${upload.body.id}`).set('Cookie', session.cookie).expect(404);
    // Should still be in process detail (deleted_at)
    const detail = await request(app).get(`/api/processes/${proc.id}`).set('Cookie', session.cookie).expect(200);
    assert.equal(detail.body.documents.length, 0);
  });
});