import { Router } from 'express';
import {
  createContractSchema,
  updateContractSchema,
  createInvoiceSchema,
  registerPaymentSchema,
  chargePaymentSchema,
} from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId, requirePermission } from '../auth/middleware';
import { PERMISSIONS } from '@advogado/shared';
import * as financeService from '../finance/service';

const router = Router();

router.use(requireAuth, requireOrg);

function isIssues(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'issues' in err);
}

router.get('/summary', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const summary = await financeService.getFinanceSummary(orgId);
    res.json(summary);
  } catch (err) { next(err); }
});

router.get('/contracts', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await financeService.listContracts(orgId, {
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/contracts', requirePermission(PERMISSIONS.BILLING_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = createContractSchema.parse(req.body);
    const contract = await financeService.createContract(orgId, data, req.user!.id, req.ip);
    res.status(201).json(contract);
  } catch (err: unknown) {
    if (isIssues(err)) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.get('/contracts/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const contract = await financeService.getContract(orgId, req.params.id!);
    res.json(contract);
  } catch (err) { next(err); }
});

router.patch('/contracts/:id', requirePermission(PERMISSIONS.BILLING_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = updateContractSchema.parse(req.body);
    const contract = await financeService.updateContract(orgId, req.params.id!, data, req.user!.id, req.ip);
    res.json(contract);
  } catch (err: unknown) {
    if (isIssues(err)) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.get('/invoices', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await financeService.listInvoices(orgId, {
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      contractId: typeof req.query.contractId === 'string' ? req.query.contractId : undefined,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/invoices', requirePermission(PERMISSIONS.BILLING_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = createInvoiceSchema.parse(req.body);
    const invoice = await financeService.createInvoice(orgId, data, req.user!.id, req.ip);
    res.status(201).json(invoice);
  } catch (err: unknown) {
    if (isIssues(err)) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.get('/invoices/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const invoice = await financeService.getInvoice(orgId, req.params.id!);
    res.json(invoice);
  } catch (err) { next(err); }
});

router.post('/payments', requirePermission(PERMISSIONS.PAYMENTS_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = registerPaymentSchema.parse(req.body);
    const payment = await financeService.registerPayment(orgId, data, req.user!.id, req.ip);
    res.status(201).json(payment);
  } catch (err: unknown) {
    if (isIssues(err)) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.post('/charges', requirePermission(PERMISSIONS.BILLING_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = chargePaymentSchema.parse(req.body);
    const result = await financeService.createCharge(orgId, data, req.user!.id, req.ip);
    res.status(201).json(result);
  } catch (err: unknown) {
    if (isIssues(err)) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.post('/payments/:id/confirm', requirePermission(PERMISSIONS.PAYMENTS_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await financeService.confirmPayment(orgId, req.params.id!, req.user!.id, req.ip);
    res.json(result);
  } catch (err: unknown) {
    if (isIssues(err)) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

export default router;