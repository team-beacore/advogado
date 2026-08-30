import { Router } from 'express';
import { requireAuth, requireOrg, getOrgId } from '../auth/middleware';
import { getSecurityReport } from '../services/settingsService';

const router = Router();

router.use(requireAuth, requireOrg);

router.get('/security', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const report = await getSecurityReport(orgId, req.user!.id);
    res.json(report);
  } catch (err) { next(err); }
});

export default router;