import { Router } from 'express';
import { professionalIdentitySchema } from '@advogado/shared';
import { PERMISSIONS } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId, requirePermission } from '../auth/middleware';
import { getIdentity, listIdentities, upsertIdentity } from '../services/professionalIdentityService';

const router = Router();

router.use(requireAuth, requireOrg);

// Lista identidades profissionais da organização (para ADMIN revisar/atribuir)
router.get('/', requirePermission(PERMISSIONS.PROCESS_DISCOVERY_VIEW), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    res.json({ items: await listIdentities(orgId) });
  } catch (err) { next(err); }
});

// Identidade do próprio usuário logado
router.get('/me', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    res.json({ identity: await getIdentity(orgId, req.user!.id) });
  } catch (err) { next(err); }
});

router.put('/me', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = professionalIdentitySchema.parse(req.body ?? {});
    const result = await upsertIdentity(orgId, req.user!.id, data);
    res.status(result.created ? 201 : 200).json({ id: result.id, created: result.created });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

export default router;