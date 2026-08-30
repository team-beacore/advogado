import { Router } from 'express';
import type { Request } from 'express';
import { createPublicationSchema, updatePublicationSchema } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId } from '../auth/middleware';
import * as publicationService from '../services/publicationService';
import { assertCasePermission, getCaseAccess } from '../services/caseService';
import { getPool } from '../db/client';
import { errors } from '../errors';

async function checkProcessEdit(req: Request, processId: string) {
  const orgId = getOrgId(req);
  const pool = getPool();
  const exists = await pool.query('SELECT id FROM cases WHERE id = $1 AND organization_id = $2', [processId, orgId]);
  if (exists.rows.length === 0) throw errors.validation('Processo inválido para esta organização.');
  const access = await getCaseAccess(orgId, processId, req.user!.id, req.user!.role);
  if (access.level !== 'edit' && access.level !== 'manage') {
    throw errors.forbidden('Permissão insuficiente para este processo.');
  }
}

async function checkPublicationAccess(req: Request, publicationId: string, required: 'view' | 'edit') {
  const orgId = getOrgId(req);
  const pub = await publicationService.getPublication(orgId, publicationId);
  await assertCasePermission(orgId, pub.process_id, req.user!.id, required, req.user!.role);
  return pub;
}

const router = Router();

router.use(requireAuth, requireOrg);

router.get('/', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await publicationService.listPublications(orgId, {
      processId: typeof req.query.processId === 'string' ? req.query.processId : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = createPublicationSchema.parse(req.body);
    await checkProcessEdit(req, data.processId);
    const pub = await publicationService.createPublication(orgId, data, req.user!.id, req.ip);
    res.status(201).json(pub);
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
    const data = updatePublicationSchema.parse(req.body);
    await checkPublicationAccess(req, req.params.id!, 'edit');
    const pub = await publicationService.updatePublication(orgId, req.params.id!, data, req.user!.id, req.ip);
    res.json(pub);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

export default router;