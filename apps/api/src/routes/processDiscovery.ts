import { Router } from 'express';
import { runDiscoverySchema, discoveryImportSchema, discoveryImportBatchSchema, listDiscoveryResultsQuerySchema } from '@advogado/shared';
import { PERMISSIONS, CAPTURE_SOURCES } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId, requirePermission } from '../auth/middleware';
import {
  runDiscovery,
  getDiscoveryStatus,
  listDiscoveryRuns,
  listDiscoveryResults,
  getDiscoveryResultDetail,
  updateDiscoveryResultStatus,
  importDiscoveryResult,
  importDiscoveryBatch,
} from '../capture/discovery/service';

const router = Router();

router.use(requireAuth, requireOrg);

router.get('/status', requirePermission(PERMISSIONS.PROCESS_DISCOVERY_VIEW), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    res.json(await getDiscoveryStatus(orgId));
  } catch (err) { next(err); }
});

router.get('/runs', requirePermission(PERMISSIONS.PROCESS_DISCOVERY_VIEW), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await listDiscoveryRuns(orgId, {
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/results', requirePermission(PERMISSIONS.PROCESS_DISCOVERY_VIEW), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const q = listDiscoveryResultsQuerySchema.parse(req.query);
    const result = await listDiscoveryResults(orgId, {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      source: q.source,
      confidence: q.confidence,
      processNumber: q.processNumber,
      court: q.court,
      discoveredFrom: q.discoveredFrom,
      discoveredTo: q.discoveredTo,
    });
    res.json(result);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Filtros inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.get('/results/:id', requirePermission(PERMISSIONS.PROCESS_DISCOVERY_VIEW), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    res.json(await getDiscoveryResultDetail(orgId, req.params.id!));
  } catch (err) { next(err); }
});

router.post('/run', requirePermission(PERMISSIONS.PROCESS_DISCOVERY_RUN), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = runDiscoverySchema.parse(req.body ?? {});
    const source = data.source as (typeof CAPTURE_SOURCES)[number] | undefined;
    const result = await runDiscovery(orgId, source, req.user!.id, req.ip);
    res.json(result);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.patch('/results/:id', requirePermission(PERMISSIONS.PROCESS_DISCOVERY_IMPORT), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { status } = req.body ?? {};
    if (!status || !['PENDING_REVIEW', 'APPROVED', 'REJECTED'].includes(status)) {
      res.status(400).json({ code: 'VALIDATION', message: 'Status inválido. Use PENDING_REVIEW, APPROVED ou REJECTED.' });
      return;
    }
    res.json(await updateDiscoveryResultStatus(orgId, req.params.id!, status, req.user!.id));
  } catch (err) { next(err); }
});

router.post('/results/:id/import', requirePermission(PERMISSIONS.PROCESS_DISCOVERY_IMPORT), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = discoveryImportSchema.parse(req.body ?? {});
    const defaultResponsibleId = req.user!.organizationType === 'SOLO' ? req.user!.id : null;
    const result = await importDiscoveryResult(orgId, req.params.id!, req.user!.id, req.ip, {
      responsibleId: data.responsibleId ?? null,
      clientId: data.clientId ?? null,
      newClient: data.newClient ?? null,
      defaultResponsibleId,
    });
    res.json(result);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.post('/results/import-batch', requirePermission(PERMISSIONS.PROCESS_DISCOVERY_IMPORT), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = discoveryImportBatchSchema.parse(req.body ?? {});
    const defaultResponsibleId = req.user!.organizationType === 'SOLO' ? req.user!.id : null;
    const result = await importDiscoveryBatch(orgId, data.ids, req.user!.id, req.ip, {
      responsibleId: data.responsibleId ?? null,
      clientId: data.clientId ?? null,
      newClient: data.newClient ?? null,
      defaultResponsibleId,
    });
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
