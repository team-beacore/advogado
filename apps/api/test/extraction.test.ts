import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb } from './helpers';
import { setAIProviderForTests } from '../src/ai/registry';
import { LocalAIProvider } from '../src/ai/local';
import type { AIProvider, AIRequest, AIResponse } from '../src/ai/provider';

class CapturingProvider implements AIProvider {
  readonly name = 'capture';
  lastRequest: AIRequest | null = null;
  isConfigured(): boolean { return true; }
  async generate(req: AIRequest): Promise<AIResponse> {
    this.lastRequest = req;
    return { text: JSON.stringify({ resumo: 'ok', fatosImportantes: [], eventosRecentes: [], pontosAtencao: [], informacoesAusentes: [] }), model: 'capture' };
  }
}

describe('Extração de texto', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);
  const provider = new CapturingProvider();

  before(async () => { await resetDb(); setAIProviderForTests(provider); });
  after(async () => { setAIProviderForTests(null); const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { provider.lastRequest = null; await resetDb(); });

  it('extracts text from plain text file', async () => {
    const session = await helper.registerAndLogin();
    const proc = await request(app).post('/api/processes').set('Cookie', session.cookie).send({ title: 'Proc', processNumber: '7777-77.2024.8.01.0001' }).expect(201);

    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .field('processId', proc.body.id)
      .field('name', 'nota.txt')
      .attach('file', Buffer.from('Conteúdo textual extraível'), { filename: 'nota.txt', contentType: 'text/plain' })
      .expect(201);

    const docId = res.body.id;
    const extract = await request(app).post(`/api/documents/${docId}/extract`).set('Cookie', session.cookie).expect(200);
    assert.equal(extract.body.status, 'EXTRACTED');
    assert.equal(extract.body.method, 'text');
    assert.ok(extract.body.text!.includes('Conteúdo textual extraível'));
  });

  it('extracts text from PDF file', async () => {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Conteúdo do PDF', { x: 20, y: 100, size: 16, font, color: rgb(0, 0, 0) });
    const pdfBytes = await doc.save();

    const session = await helper.registerAndLogin();
    const proc = await request(app).post('/api/processes').set('Cookie', session.cookie).send({ title: 'Proc PDF', processNumber: '8888-88.2024.8.01.0001' }).expect(201);
    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .field('processId', proc.body.id)
      .field('name', 'teste.pdf')
      .attach('file', Buffer.from(pdfBytes), { filename: 'teste.pdf', contentType: 'application/pdf' })
      .expect(201);
    const extract = await request(app).post(`/api/documents/${res.body.id}/extract`).set('Cookie', session.cookie).expect(200);
    assert.equal(extract.body.status, 'EXTRACTED');
    assert.ok(extract.body.text!.includes('Conteúdo do PDF'));
  });

  it('extracts text from DOCX file', async () => {
    const { Packer, Document, Paragraph, TextRun } = await import('docx');
    const docx = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('Conteúdo do DOCX')] })] }] });
    const docxBytes = await Packer.toBuffer(docx);

    const session = await helper.registerAndLogin();
    const proc = await request(app).post('/api/processes').set('Cookie', session.cookie).send({ title: 'Proc DOCX', processNumber: '9999-99.2024.8.01.0001' }).expect(201);
    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .field('processId', proc.body.id)
      .field('name', 'teste.docx')
      .attach('file', Buffer.from(docxBytes), { filename: 'teste.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      .expect(201);
    const extract = await request(app).post(`/api/documents/${res.body.id}/extract`).set('Cookie', session.cookie).expect(200);
    assert.equal(extract.body.status, 'EXTRACTED');
    assert.ok(extract.body.text!.includes('Conteúdo do DOCX'));
  });

  it('extraction status appears in document list', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .field('name', 'doc.txt')
      .attach('file', Buffer.from('texto'), { filename: 'doc.txt', contentType: 'text/plain' })
      .expect(201);
    await request(app).post(`/api/documents/${res.body.id}/extract`).set('Cookie', session.cookie).expect(200);
    const list = await request(app).get('/api/documents').set('Cookie', session.cookie).expect(200);
    const doc = list.body.items.find((d: { id: string }) => d.id === res.body.id);
    assert.ok(doc, 'documento deve estar na lista');
    assert.equal(doc.extraction_status, 'EXTRACTED');
  });

  it('includes extracted text in AI context for summarize', async () => {
    const session = await helper.registerAndLogin();
    const proc = await request(app).post('/api/processes').set('Cookie', session.cookie).send({ title: 'Proc AI', processNumber: '1010-10.2024.8.01.0001' }).expect(201);

    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .field('processId', proc.body.id)
      .field('name', 'info.txt')
      .attach('file', Buffer.from('Documento extraído para contexto AI'), { filename: 'info.txt', contentType: 'text/plain' })
      .expect(201);
    await request(app).post(`/api/documents/${res.body.id}/extract`).set('Cookie', session.cookie).expect(200);

    await request(app).post(`/api/ai/processes/${proc.body.id}/summarize`).set('Cookie', session.cookie).expect(200);

    assert.ok(provider.lastRequest, 'AI provider should have been called');
    assert.ok(provider.lastRequest!.system.includes('Documento extraído para contexto AI'), 'AI context should include extracted text');
  });
});

describe('Provider de IA local', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); setAIProviderForTests(new LocalAIProvider()); });
  after(async () => { setAIProviderForTests(null); const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  it('returns configured=true with provider local-rules', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app).get('/api/ai/status').set('Cookie', session.cookie).expect(200);
    assert.equal(res.body.configured, true);
    assert.equal(res.body.provider, 'local-rules');
    assert.ok(res.body.disclaimer);
  });

  it('executes summarize and records interaction with local provider', async () => {
    const session = await helper.registerAndLogin();
    const proc = await request(app).post('/api/processes').set('Cookie', session.cookie).send({ title: 'Proc Local AI', processNumber: '9999-99.2024.8.01.0001' }).expect(201);
    const res = await request(app).post(`/api/ai/processes/${proc.body.id}/summarize`).set('Cookie', session.cookie).expect(200);
    assert.ok(res.body.interactionId);
    assert.ok(res.body.structured);
    assert.ok(res.body.structured.resumo);
  });
});