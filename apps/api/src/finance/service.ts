import { z } from 'zod';
import {
  createContractSchema,
  updateContractSchema,
  createInvoiceSchema,
  registerPaymentSchema,
  chargePaymentSchema,
} from '@advogado/shared';
import { errors } from '../errors';
import { getPool } from '../db/client';
import { auditLog } from '../audit/audit';
import { getPaymentGateway } from './registry';
import type { GatewayCharge } from './gateway';

export type CreateContractInput = z.infer<typeof createContractSchema>;
export type UpdateContractInput = z.infer<typeof updateContractSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type RegisterPaymentInput = z.infer<typeof registerPaymentSchema>;
export type ChargePaymentInput = z.infer<typeof chargePaymentSchema>;

export async function createContract(organizationId: string, input: CreateContractInput, userId: string, ip?: string) {
  const pool = getPool();
  const res = await pool.query(
    `INSERT INTO contracts (organization_id, client_id, case_id, title, description, total_value, status, start_date, end_date, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      organizationId,
      input.clientId ?? null,
      input.caseId ?? null,
      input.title,
      input.description ?? null,
      input.totalValue ?? 0,
      input.status ?? 'DRAFT',
      input.startDate ?? null,
      input.endDate ?? null,
      input.notes ?? null,
      userId,
    ],
  );
  const contract = res.rows[0];
  void auditLog({
    organizationId,
    userId,
    action: 'CONTRACT_CREATED',
    entity: 'contract',
    entityId: contract.id,
    after: { title: contract.title, totalValue: contract.total_value },
    ip,
  });
  return contract;
}

export async function updateContract(organizationId: string, contractId: string, input: UpdateContractInput, userId: string, ip?: string) {
  const pool = getPool();
  const before = await pool.query('SELECT * FROM contracts WHERE id = $1 AND organization_id = $2', [contractId, organizationId]);
  if (before.rows.length === 0) throw errors.notFound('Contrato não encontrado.');
  const current = before.rows[0];
  const res = await pool.query(
    `UPDATE contracts SET
       client_id = $3,
       case_id = $4,
       title = $5,
       description = $6,
       total_value = $7,
       status = $8,
       start_date = $9,
       end_date = $10,
       notes = $11,
       updated_at = now()
     WHERE id = $1 AND organization_id = $2 RETURNING *`,
    [
      contractId,
      organizationId,
      input.clientId !== undefined ? input.clientId : current.client_id,
      input.caseId !== undefined ? input.caseId : current.case_id,
      input.title ?? current.title,
      input.description !== undefined ? input.description : current.description,
      input.totalValue !== undefined ? input.totalValue : current.total_value,
      input.status ?? current.status,
      input.startDate !== undefined ? input.startDate : current.start_date,
      input.endDate !== undefined ? input.endDate : current.end_date,
      input.notes !== undefined ? input.notes : current.notes,
    ],
  );
  void auditLog({
    organizationId,
    userId,
    action: 'CONTRACT_UPDATED',
    entity: 'contract',
    entityId: contractId,
    before: current,
    after: res.rows[0],
    ip,
  });
  return res.rows[0];
}

export interface ContractListOptions {
  page?: number;
  pageSize?: number;
  status?: string;
}

export async function listContracts(organizationId: string, opts: ContractListOptions = {}) {
  const pool = getPool();
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const params: unknown[] = [organizationId];
  let where = 'c.organization_id = $1';
  if (opts.status) {
    params.push(opts.status);
    where += ` AND c.status = $${params.length}`;
  }
  params.push(pageSize, (page - 1) * pageSize);
  const res = await pool.query(
    `SELECT c.*, cl.name AS client_name
     FROM contracts c
     LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE ${where}
     ORDER BY c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const countRes = await pool.query(`SELECT count(*)::int AS total FROM contracts c WHERE ${where}`, params.slice(0, params.length - 2));
  return { items: res.rows, total: countRes.rows[0]?.total ?? 0, page, pageSize };
}

export async function getContract(organizationId: string, contractId: string) {
  const pool = getPool();
  const res = await pool.query('SELECT * FROM contracts WHERE id = $1 AND organization_id = $2', [contractId, organizationId]);
  if (res.rows.length === 0) throw errors.notFound('Contrato não encontrado.');
  const contract = res.rows[0];
  const invoices = await pool.query(
    `SELECT i.*,
       (SELECT count(*)::int FROM installments ins WHERE ins.invoice_id = i.id) AS installment_count
     FROM invoices i
     WHERE i.contract_id = $1 AND i.organization_id = $2
     ORDER BY i.due_date ASC NULLS LAST, i.created_at ASC`,
    [contractId, organizationId],
  );
  const installments = await pool.query(
    `SELECT ins.*, i.description AS invoice_description
     FROM installments ins
     JOIN invoices i ON i.id = ins.invoice_id
     WHERE i.contract_id = $1 AND ins.organization_id = $2
     ORDER BY ins.number ASC`,
    [contractId, organizationId],
  );
  return { ...contract, invoices: invoices.rows, installments: installments.rows };
}

export async function createInvoice(organizationId: string, input: CreateInvoiceInput, userId: string, ip?: string) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invRes = await client.query(
      `INSERT INTO invoices (organization_id, contract_id, client_id, description, amount, status, due_date, external_reference, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        organizationId,
        input.contractId ?? null,
        input.clientId ?? null,
        input.description,
        input.amount ?? 0,
        input.status ?? 'PENDING',
        input.dueDate ?? null,
        input.externalReference ?? null,
        userId,
      ],
    );
    const invoice = invRes.rows[0];
    const count = input.installmentCount ?? 1;
    const amount = Number(input.amount ?? 0);
    const base = Math.round((amount * 100) / count) / 100;
    const dueDate = input.dueDate ? new Date(input.dueDate) : new Date();
    for (let i = 1; i <= count; i++) {
      const installmentAmount = i === count ? Math.round((amount - base * (count - 1)) * 100) / 100 : base;
      const instDue = new Date(dueDate);
      instDue.setMonth(instDue.getMonth() + (i - 1));
      await client.query(
        `INSERT INTO installments (organization_id, invoice_id, number, due_date, amount)
         VALUES ($1, $2, $3, $4, $5)`,
        [organizationId, invoice.id, i, instDue, installmentAmount],
      );
    }
    await client.query('COMMIT');
    void auditLog({
      organizationId,
      userId,
      action: 'INVOICE_CREATED',
      entity: 'invoice',
      entityId: invoice.id,
      after: { description: invoice.description, amount: invoice.amount, installmentCount: count },
      ip,
    });
    return invoice;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface InvoiceListOptions {
  page?: number;
  pageSize?: number;
  status?: string;
  contractId?: string;
}

export async function listInvoices(organizationId: string, opts: InvoiceListOptions = {}) {
  const pool = getPool();
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const params: unknown[] = [organizationId];
  let where = 'i.organization_id = $1';
  if (opts.status) {
    params.push(opts.status);
    where += ` AND i.status = $${params.length}`;
  }
  if (opts.contractId) {
    params.push(opts.contractId);
    where += ` AND i.contract_id = $${params.length}`;
  }
  params.push(pageSize, (page - 1) * pageSize);
  const res = await pool.query(
    `SELECT i.*, cl.name AS client_name, c.title AS contract_title,
       (SELECT COALESCE(sum(p.amount), 0)::numeric FROM payments p WHERE p.invoice_id = i.id AND p.status = 'PAID') AS paid_amount,
       (SELECT count(*)::int FROM installments ins WHERE ins.invoice_id = i.id) AS installment_count
     FROM invoices i
     LEFT JOIN clients cl ON cl.id = i.client_id
     LEFT JOIN contracts c ON c.id = i.contract_id
     WHERE ${where}
     ORDER BY i.due_date ASC NULLS LAST, i.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const countRes = await pool.query(`SELECT count(*)::int AS total FROM invoices i WHERE ${where}`, params.slice(0, params.length - 2));
  return { items: res.rows, total: countRes.rows[0]?.total ?? 0, page, pageSize };
}

export async function getInvoice(organizationId: string, invoiceId: string) {
  const pool = getPool();
  const res = await pool.query('SELECT * FROM invoices WHERE id = $1 AND organization_id = $2', [invoiceId, organizationId]);
  if (res.rows.length === 0) throw errors.notFound('Cobrança não encontrada.');
  const invoice = res.rows[0];
  const installments = await pool.query(
    'SELECT * FROM installments WHERE invoice_id = $1 AND organization_id = $2 ORDER BY number ASC',
    [invoiceId, organizationId],
  );
  const payments = await pool.query(
    'SELECT * FROM payments WHERE invoice_id = $1 AND organization_id = $2 ORDER BY created_at DESC',
    [invoiceId, organizationId],
  );
  return { ...invoice, installments: installments.rows, payments: payments.rows };
}

export async function registerPayment(organizationId: string, input: RegisterPaymentInput, userId: string, ip?: string) {
  const pool = getPool();
  const status = input.status ?? 'PAID';
  const res = await pool.query(
    `INSERT INTO payments (organization_id, invoice_id, installment_id, client_id, amount, method, status, gateway, external_reference, metadata, paid_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      organizationId,
      input.invoiceId ?? null,
      input.installmentId ?? null,
      input.clientId ?? null,
      input.amount,
      input.method ?? 'PIX',
      status,
      input.gateway ?? null,
      input.externalReference ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      status === 'PAID' ? new Date() : null,
      userId,
    ],
  );
  const payment = res.rows[0];
  if (payment.status === 'PAID') {
    if (payment.invoice_id) {
      const totalRes = await pool.query(
        `SELECT COALESCE(sum(p.amount), 0)::numeric AS paid
         FROM payments p
         WHERE p.invoice_id = $1 AND p.organization_id = $2 AND p.status = 'PAID'`,
        [payment.invoice_id, organizationId],
      );
      const invRes = await pool.query('SELECT amount FROM invoices WHERE id = $1 AND organization_id = $2', [payment.invoice_id, organizationId]);
      const amount = Number(invRes.rows[0]?.amount ?? 0);
      const paid = Number(totalRes.rows[0]?.paid ?? 0);
      if (paid >= amount - 0.005) {
        await pool.query(
          `UPDATE invoices SET status = 'PAID', paid_at = now() WHERE id = $1 AND organization_id = $2`,
          [payment.invoice_id, organizationId],
        );
      }
    }
    if (payment.installment_id) {
      await pool.query(
        `UPDATE installments SET status = 'PAID', paid_at = now() WHERE id = $1 AND organization_id = $2`,
        [payment.installment_id, organizationId],
      );
    }
  }
  void auditLog({
    organizationId,
    userId,
    action: 'PAYMENT_REGISTERED',
    entity: 'payment',
    entityId: payment.id,
    after: { invoiceId: payment.invoice_id, installmentId: payment.installment_id, amount: payment.amount, status: payment.status, method: payment.method },
    ip,
  });
  return payment;
}

async function getGatewayConfig(organizationId: string, name: string): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const res = await pool.query('SELECT value FROM settings WHERE organization_id = $1 AND key = $2', [organizationId, `integration.payments.${name}`]);
  const value = res.rows[0]?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function createCharge(organizationId: string, input: ChargePaymentInput, userId: string, ip?: string) {
  const pool = getPool();
  const invRes = await pool.query('SELECT * FROM invoices WHERE id = $1 AND organization_id = $2', [input.invoiceId, organizationId]);
  if (invRes.rows.length === 0) throw errors.notFound('Cobrança não encontrada.');
  const invoice = invRes.rows[0];

  const gateway = getPaymentGateway(input.gateway);
  const config = await getGatewayConfig(organizationId, input.gateway);
  if (!gateway.isConfigured(config)) {
    throw errors.validation('Gateway de pagamento não configurado.');
  }

  let customer: GatewayCharge['customer'] = null;
  if (invoice.client_id) {
    const cli = await pool.query('SELECT name, email, cpf_cnpj FROM clients WHERE id = $1 AND organization_id = $2', [invoice.client_id, organizationId]);
    if (cli.rows[0]) {
      customer = {
        name: cli.rows[0].name,
        email: cli.rows[0].email,
        taxId: cli.rows[0].cpf_cnpj,
      };
    }
  }

  let gatewayData;
  try {
    gatewayData = await gateway.createCharge(
      {
        amount: Math.round(Number(invoice.amount) * 100),
        description: invoice.description,
        externalReference: invoice.external_reference ?? invoice.id,
        customer,
      },
      config!,
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 502) {
      const failRes = await pool.query(
        `INSERT INTO payments (organization_id, invoice_id, client_id, amount, method, status, gateway, metadata, created_by)
         VALUES ($1, $2, $3, $4, 'PIX', 'FAILED', $5, $6, $7) RETURNING *`,
        [organizationId, invoice.id, invoice.client_id, invoice.amount, input.gateway, JSON.stringify({ error: (err as Error).message }), userId],
      );
      void auditLog({
        organizationId,
        userId,
        action: 'CHARGE_FAILED',
        entity: 'payment',
        entityId: failRes.rows[0].id,
        after: { invoiceId: invoice.id, gateway: input.gateway, error: (err as Error).message },
        ip,
      });
    }
    throw err;
  }

  const payRes = await pool.query(
    `INSERT INTO payments (organization_id, invoice_id, client_id, amount, method, status, gateway, external_reference, metadata, created_by)
     VALUES ($1, $2, $3, $4, 'PIX', 'PENDING', $5, $6, $7, $8) RETURNING *`,
    [
      organizationId,
      invoice.id,
      invoice.client_id,
      invoice.amount,
      input.gateway,
      gatewayData.gatewayChargeId,
      JSON.stringify({ ...(input.metadata ?? {}), checkoutUrl: gatewayData.checkoutUrl ?? null, gatewayData: gatewayData.raw ?? {} }),
      userId,
    ],
  );
  void auditLog({
    organizationId,
    userId,
    action: 'CHARGE_CREATED',
    entity: 'payment',
    entityId: payRes.rows[0].id,
    after: { invoiceId: invoice.id, gateway: input.gateway, gatewayChargeId: gatewayData.gatewayChargeId, checkoutUrl: gatewayData.checkoutUrl ?? null },
    ip,
  });
  return {
    payment: payRes.rows[0],
    gatewayChargeId: gatewayData.gatewayChargeId,
    checkoutUrl: gatewayData.checkoutUrl ?? null,
    status: gatewayData.status,
  };
}

export async function confirmPayment(organizationId: string, paymentId: string, userId: string, ip?: string) {
  const pool = getPool();
  const payRes = await pool.query('SELECT * FROM payments WHERE id = $1 AND organization_id = $2', [paymentId, organizationId]);
  if (payRes.rows.length === 0) throw errors.notFound('Pagamento não encontrado.');
  const payment = payRes.rows[0];
  if (!payment.gateway || !payment.external_reference) {
    throw errors.validation('Pagamento sem referência externa de gateway.');
  }
  const gateway = getPaymentGateway(payment.gateway as 'mercadopago' | 'stripe');
  const config = await getGatewayConfig(organizationId, payment.gateway as string);
  if (!gateway.isConfigured(config)) throw errors.validation('Gateway de pagamento não configurado.');
  const status = await gateway.checkStatus(payment.external_reference, config!);

  if (status.paid && payment.status !== 'PAID') {
    await pool.query(`UPDATE payments SET status = 'PAID', paid_at = now() WHERE id = $1`, [paymentId]);
    if (payment.invoice_id) {
      await pool.query(`UPDATE invoices SET status = 'PAID', paid_at = now() WHERE id = $1 AND organization_id = $2`, [payment.invoice_id, organizationId]);
    }
    if (payment.installment_id) {
      await pool.query(`UPDATE installments SET status = 'PAID', paid_at = now() WHERE id = $1 AND organization_id = $2`, [payment.installment_id, organizationId]);
    }
    void auditLog({
      organizationId,
      userId,
      action: 'PAYMENT_CONFIRMED',
      entity: 'payment',
      entityId: paymentId,
      after: { invoiceId: payment.invoice_id, gateway: payment.gateway, gatewayStatus: status.status },
      ip,
    });
  }
  const updated = await pool.query('SELECT * FROM payments WHERE id = $1', [paymentId]);
  return { payment: updated.rows[0], gatewayStatus: status.status, paid: status.paid };
}

export async function getFinanceSummary(organizationId: string) {
  const pool = getPool();
  const receivable = await pool.query(
    `SELECT COALESCE(sum(amount), 0)::numeric AS total, count(*)::int AS count
     FROM invoices WHERE organization_id = $1 AND status IN ('PENDING', 'OVERDUE')`,
    [organizationId],
  );
  const received = await pool.query(
    `SELECT COALESCE(sum(amount), 0)::numeric AS total, count(*)::int AS count
     FROM payments WHERE organization_id = $1 AND status = 'PAID'`,
    [organizationId],
  );
  const byStatus = await pool.query(
    `SELECT status, count(*)::int AS count, COALESCE(sum(amount), 0)::numeric AS total
     FROM invoices WHERE organization_id = $1 GROUP BY status`,
    [organizationId],
  );
  return {
    receivable: { total: Number(receivable.rows[0]?.total ?? 0), count: receivable.rows[0]?.count ?? 0 },
    received: { total: Number(received.rows[0]?.total ?? 0), count: received.rows[0]?.count ?? 0 },
    byStatus: byStatus.rows.map((r) => ({ status: r.status, count: r.count, total: Number(r.total) })),
  };
}