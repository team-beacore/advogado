import { Router } from 'express';
import { requireAuth, requireOrg, getOrgId } from '../auth/middleware';
import { listAuditLogs } from '../audit/audit';

const router = Router();

router.use(requireAuth, requireOrg);

router.get('/', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await listAuditLogs(orgId, {
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
      action: typeof req.query.action === 'string' ? req.query.action : undefined,
      entity: typeof req.query.entity === 'string' ? req.query.entity : undefined,
    });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;