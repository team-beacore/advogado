import { Router } from 'express';
import { runCaptureSchema } from '@advogado/shared';
import { PERMISSIONS } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId, requirePermission } from '../auth/middleware';
import { runCapture, getCaptureStatus, saveCaptureConfig, deleteCaptureConfig, listCaptureConfigs } from '../capture/service';

const router = Router();

router.use(requireAuth, requireOrg);

router.get('/status', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    res.json(await getCaptureStatus(orgId));
  } catch (err) { next(err); }
});

router.get('/config', requirePermission(PERMISSIONS.CAPTURE_MANAGE), async (req, res, next) => {
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

router.put('/config', requirePermission(PERMISSIONS.CAPTURE_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { adapter, enabled } = req.body;
    if (!adapter) { res.status(400).json({ code: 'VALIDATION', message: 'adapter é obrigatório.' }); return; }
    // ADMIN pode apenas ativar/desativar; a configuração técnica é definida pelo SUPER ADMIN
    const existing = await listCaptureConfigs(orgId).then((list) => list.find((c) => c.adapter === adapter.toUpperCase()));
    const config: Record<string, unknown> = { enabled: Boolean(enabled) };
    if (existing) {
      config.login = existing.login;
      config.baseUrl = existing.baseUrl;
      // preserva a senha existente via placeholder (saveCaptureConfig mantém a atual)
      config.password = existing.passwordSet ? 'placeholder' : undefined;
    }
    await saveCaptureConfig(orgId, adapter, config);
    res.json({ ok: true, adapter });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.delete('/config/:adapter', requirePermission(PERMISSIONS.CAPTURE_MANAGE), async (req, res, next) => {
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