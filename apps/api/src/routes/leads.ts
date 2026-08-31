import { Router } from 'express';
import { createLeadSchema, updateLeadSchema, convertLeadSchema } from '@advogado/shared';
import { PERMISSIONS } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId, requirePermission } from '../auth/middleware';
import * as leadService from '../services/leadService';

const router = Router();

router.use(requireAuth, requireOrg);

router.get('/', requirePermission(PERMISSIONS.LEADS_READ), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await leadService.listLeads(orgId, {
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/', requirePermission(PERMISSIONS.LEADS_CREATE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = createLeadSchema.parse(req.body);
    const lead = await leadService.createLead(orgId, data, req.user!.id, req.ip);
    res.status(201).json(lead);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = updateLeadSchema.parse(req.body);
    const lead = await leadService.updateLead(orgId, req.params.id!, data, req.user!.id, req.ip);
    res.json(lead);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.post('/:id/convert', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = convertLeadSchema.parse(req.body ?? {});
    const result = await leadService.convertLeadToClient(orgId, req.params.id!, req.user!.id, req.ip, data.clientName);
    res.json(result);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

export default router;