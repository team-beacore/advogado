import { Router } from 'express';
import { requireAuth, requireOrg, getOrgId } from '../auth/middleware';
import { getDashboard } from '../services/dashboardService';

const router = Router();

router.use(requireAuth, requireOrg);

router.get('/', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const dashboard = await getDashboard(orgId);
    res.json(dashboard);
  } catch (err) { next(err); }
});

export default router;