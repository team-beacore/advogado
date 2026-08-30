import { Router } from 'express';
import { runCaptureSchema, captureConfigSchema } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId, requireRole } from '../auth/middleware';
import { runCapture, getCaptureStatus, saveCaptureConfig, deleteCaptureConfig, listCaptureConfigs } from '../capture/service';

const router = Router();

router.use(requireAuth, requireOrg);

router.get('/status', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    res.json(await getCaptureStatus(orgId));
  } catch (err) { next(err); }
});

router.get('/config', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    res.json(await listCaptureConfigs(orgId));
  } catch (err) { next(err); }
});

router.post('/run', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = runCaptureSchema.parse(req.body ?? {});
    const result = await runCapture(orgId, data.adapters, req.user!.id, req.ip);
    res.json(result);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.put('/config', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = captureConfigSchema.parse(req.body);
    await saveCaptureConfig(orgId, data.adapter, {
      enabled: data.enabled,
      login: data.login,
      password: data.password,
      baseUrl: data.baseUrl,
    });
    res.json({ ok: true, adapter: data.adapter });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.delete('/config/:adapter', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const adapter = req.params.adapter?.toUpperCase();
    if (!adapter || !['PJE', 'ESAJ', 'PROJUDI'].includes(adapter)) {
      res.status(400).json({ code: 'VALIDATION', message: 'Adapter inválido. Use: PJE, ESAJ ou PROJUDI.' });
      return;
    }
    await deleteCaptureConfig(orgId, adapter);
    res.json({ ok: true, adapter });
  } catch (err) { next(err); }
});

export default router;