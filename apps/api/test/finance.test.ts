import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb } from './helpers';

describe('Módulo financeiro', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);

  before(async () => { await resetDb(); });
  after(async () => { const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); });

  async function createClient(session: { cookie: string }) {
    const res = await request(app).post('/api/clients').set('Cookie', session.cookie).send({ name: 'Cliente Financeiro' }).expect(201);
    return res.body;
  }

  it('cria contrato', async () => {
    const session = await helper.registerAndLogin();
    const client = await createClient(session);
    const res = await request(app)
      .post('/api/finance/contracts')
      .set('Cookie', session.cookie)
      .send({ clientId: client.id, title: 'Contrato Honorários', totalValue: 1000, status: 'ACTIVE' })
      .expect(201);
    assert.equal(res.body.title, 'Contrato Honorários');
    assert.equal(res.body.status, 'ACTIVE');
  });

  it('cria cobrança com parcelas e gera installments', async () => {
    const session = await helper.registerAndLogin();
    const client = await createClient(session);
    const contract = await request(app)
      .post('/api/finance/contracts')
      .set('Cookie', session.cookie)
      .send({ clientId: client.id, title: 'Contrato', totalValue: 300, status: 'ACTIVE' })
      .expect(201);

    const invoice = await request(app)
      .post('/api/finance/invoices')
      .set('Cookie', session.cookie)
      .send({
        contractId: contract.body.id,
        description: 'Honorários 3x',
        amount: 300,
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        installmentCount: 3,
      })
      .expect(201);

    const detail = await request(app).get(`/api/finance/invoices/${invoice.body.id}`).set('Cookie', session.cookie).expect(200);
    assert.equal(detail.body.installments.length, 3);
    const total = detail.body.installments.reduce((s: number, i: { amount: string }) => s + Number(i.amount), 0);
    assert.equal(total, 300);
  });

  it('registra pagamento e marca cobrança como paga', async () => {
    const session = await helper.registerAndLogin();
    const client = await createClient(session);
    const invoice = await request(app)
      .post('/api/finance/invoices')
      .set('Cookie', session.cookie)
      .send({ clientId: client.id, description: 'Cobrança única', amount: 500 })
      .expect(201);

    await request(app)
      .post('/api/finance/payments')
      .set('Cookie', session.cookie)
      .send({ invoiceId: invoice.body.id, amount: 500, method: 'PIX' })
      .expect(201);

    const detail = await request(app).get(`/api/finance/invoices/${invoice.body.id}`).set('Cookie', session.cookie).expect(200);
    assert.equal(detail.body.status, 'PAID');
  });

  it('cobrança no gateway retorna erro claro quando não configurado', async () => {
    const session = await helper.registerAndLogin();
    const invoice = await request(app)
      .post('/api/finance/invoices')
      .set('Cookie', session.cookie)
      .send({ description: 'Cobrança gateway', amount: 100 })
      .expect(201);

    const res = await request(app)
      .post('/api/finance/charges')
      .set('Cookie', session.cookie)
      .send({ invoiceId: invoice.body.id, gateway: 'mercadopago' })
      .expect(400);
    assert.match(res.body.message, /não configurado/i);
  });

  it('resumo financeiro reflete valores reais', async () => {
    const session = await helper.registerAndLogin();
    const invoice = await request(app)
      .post('/api/finance/invoices')
      .set('Cookie', session.cookie)
      .send({ description: 'Pendente', amount: 200 })
      .expect(201);
    await request(app)
      .post('/api/finance/payments')
      .set('Cookie', session.cookie)
      .send({ invoiceId: invoice.body.id, amount: 200, method: 'PIX' })
      .expect(201);

    const summary = await request(app).get('/api/finance/summary').set('Cookie', session.cookie).expect(200);
    assert.equal(summary.body.received.count, 1);
    assert.equal(summary.body.received.total, 200);
  });

  it('isola financeiro entre organizações', async () => {
    const a = await helper.registerAndLogin();
    const b = await helper.registerAndLogin();
    await request(app)
      .post('/api/finance/contracts')
      .set('Cookie', a.cookie)
      .send({ title: 'Contrato A', totalValue: 50 })
      .expect(201);

    const res = await request(app).get('/api/finance/contracts').set('Cookie', b.cookie).expect(200);
    assert.equal(res.body.items.length, 0);
  });
});