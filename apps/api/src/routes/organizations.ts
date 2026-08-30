import { Router } from 'express';
import { createOrganizationSchema } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId, requireRole } from '../auth/middleware';
import * as orgService from '../services/orgService';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const orgs = await orgService.listOrganizations(req.user!.id);
    res.json(orgs);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const data = createOrganizationSchema.parse(req.body);
    const org = await orgService.createOrganization(data.name, req.user!.id, req.ip);
    // Set session org to this new org
    // (the user will need to switch orgs; for now the next login sets it)
    res.status(201).json(org);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.get('/current', requireOrg, async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const pool = (await import('../db/client')).getPool();
    const org = await pool.query('SELECT * FROM organizations WHERE id = $1', [orgId]);
    res.json(org.rows[0] ?? null);
  } catch (err) { next(err); }
});

router.get('/:orgId/members', async (req, res, next) => {
  try {
    const members = await orgService.listOrganizationUsers(req.params.orgId!);
    res.json(members);
  } catch (err) { next(err); }
});

router.post('/:orgId/members', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { email, role } = req.body;
    const result = await orgService.addOrganizationUser(req.params.orgId!, email, role ?? 'LAWYER', req.user!.id, req.ip);
    res.status(201).json(result);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'message' in err) {
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({ code: 'ERROR', message: (err as Error).message });
      return;
    }
    next(err);
  }
});

router.patch('/:orgId/members/:userId', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const result = await orgService.updateMemberRole(req.params.orgId!, req.params.userId!, req.body.role, req.user!.id, req.ip);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;