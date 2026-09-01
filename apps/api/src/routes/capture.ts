import { Router } from 'express';
import { runCaptureSchema } from '@advogado/shared';
import { PERMISSIONS, CAPTURE_SOURCES } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId, requirePermission } from '../auth/middleware';
import {
  runCapture,
  getCaptureStatus,
  saveSourceConfig,
  deleteSourceConfig,
  listSourceConfigs,
  testSourceConnection,
  listCaptureRuns,
} from '../capture/service';

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
    res.json(await listSourceConfigs(orgId));
  } catch (err) { next(err); }
});

router.get('/runs', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await listCaptureRuns(orgId, {
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/run', requirePermission(PERMISSIONS.PUBLICATIONS_CREATE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = runCaptureSchema.parse(req.body ?? {});
    // Por padrão executa a demonstração (única fonte funcional sem credenciais)
    const source = data.source ?? 'DEMO';
    const result = await runCapture(orgId, source, req.user!.id, req.ip);
    res.json(result);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.post('/test', requirePermission(PERMISSIONS.PUBLICATIONS_CREATE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { source, config } = req.body ?? {};
    const src = String(source ?? 'DEMO');
    if (!CAPTURE_SOURCES.includes(src as (typeof CAPTURE_SOURCES)[number])) {
      res.status(400).json({ code: 'VALIDATION', message: 'Fonte inválida.' });
      return;
    }
    const result = await testSourceConnection(orgId, src as (typeof CAPTURE_SOURCES)[number], config);
    res.json(result);
  } catch (err) { next(err); }
});

router.put('/config', requirePermission(PERMISSIONS.CAPTURE_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { source, enabled } = req.body;
    if (!source || !CAPTURE_SOURCES.includes(source as (typeof CAPTURE_SOURCES)[number])) {
      res.status(400).json({ code: 'VALIDATION', message: 'Fonte inválida.' });
      return;
    }
    // ADMIN pode apenas ativar/desativar; a configuração técnica é definida pelo SUPER ADMIN
    const existing = await listSourceConfigs(orgId).then((list) => list.find((c) => c.source === source.toUpperCase()));
    const config: Record<string, unknown> = { enabled: Boolean(enabled) };
    if (existing) {
      config.login = existing.login;
      config.baseUrl = existing.baseUrl;
      // preserva a senha existente via placeholder (saveSourceConfig mantém a atual)
      config.password = existing.passwordSet ? 'placeholder' : undefined;
    }
    await saveSourceConfig(orgId, source, config);
    res.json({ ok: true, source });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.delete('/config/:source', requirePermission(PERMISSIONS.CAPTURE_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const source = req.params.source?.toUpperCase();
    if (!source || !CAPTURE_SOURCES.includes(source as (typeof CAPTURE_SOURCES)[number])) {
      res.status(400).json({ code: 'VALIDATION', message: 'Fonte inválida.' });
      return;
    }
    await deleteSourceConfig(orgId, source);
    res.json({ ok: true, source });
  } catch (err) { next(err); }
});

export default router;
