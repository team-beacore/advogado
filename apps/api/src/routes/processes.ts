import { Router } from 'express';
import { createCaseSchema, updateCaseSchema, listCasesQuerySchema, addMemberSchema, createEventSchema, updateCaseMemberPermissionsSchema } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId, requirePermission } from '../auth/middleware';
import { PERMISSIONS } from '@advogado/shared';
import * as caseService from '../services/caseService';
import { addEvent, listEvents } from '../events/timeline';
import { auditLog } from '../audit/audit';
import { syncCase, listCaseSyncRuns } from '../capture/sync/service';
import { getPool } from '../db/client';

const router = Router();

router.use(requireAuth, requireOrg);

async function assertPermission(req: Parameters<typeof getOrgId>[0], caseId: string, required: 'view' | 'edit' | 'manage') {
  const orgId = getOrgId(req);
  await caseService.assertCasePermission(orgId, caseId, req.user!.id, required, req.user!.role);
}

router.get('/', requirePermission(PERMISSIONS.PROCESSES_READ), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const q = listCasesQuerySchema.parse(req.query);
    const result = await caseService.listCases(orgId, req.user!.id, {
      search: q.search,
      status: q.status,
      clientId: q.clientId,
      area: q.area,
      sort: q.sort,
      page: q.page,
      pageSize: q.pageSize,
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

router.post('/', requirePermission(PERMISSIONS.PROCESSES_CREATE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = createCaseSchema.parse(req.body);
    const caseRow = await caseService.createCase(orgId, data, req.user!.id, req.ip);
    res.status(201).json(caseRow);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    await assertPermission(req, req.params.id!, 'view');
    const orgId = getOrgId(req);
    const detail = await caseService.getCaseDetail(orgId, req.params.id!);
    res.json(detail);
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    await assertPermission(req, req.params.id!, 'edit');
    const orgId = getOrgId(req);
    const data = updateCaseSchema.parse(req.body);
    const caseRow = await caseService.updateCase(orgId, req.params.id!, data, req.user!.id, req.ip);
    res.json(caseRow);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.get('/:id/events', async (req, res, next) => {
  try {
    await assertPermission(req, req.params.id!, 'view');
    const events = await listEvents(req.params.id!);
    res.json(events);
  } catch (err) { next(err); }
});

// Histórico de sincronizações do processo (capture_runs).
router.get('/:id/sync-runs', async (req, res, next) => {
  try {
    await assertPermission(req, req.params.id!, 'view');
    const orgId = getOrgId(req);
    const result = await listCaseSyncRuns(orgId, req.params.id!, {
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// Sincronização manual do processo com sua fonte de dados (DataJud).
router.post('/:id/sync', async (req, res, next) => {
  try {
    await assertPermission(req, req.params.id!, 'edit');
    const orgId = getOrgId(req);
    const result = await syncCase(orgId, req.params.id!, req.user!.id, req.ip);
    res.json(result);
  } catch (err) { next(err); }
});

// Ativar/pausar monitoramento automático do processo.
router.patch('/:id/monitoring', async (req, res, next) => {
  try {
    await assertPermission(req, req.params.id!, 'edit');
    const orgId = getOrgId(req);
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ code: 'VALIDATION', message: 'Informe enabled: true ou false.' });
      return;
    }
    const newStatus = enabled ? 'ACTIVE' : 'PAUSED';
    const pool = getPool();
    await pool.query(
      'UPDATE cases SET monitoring_status = $1, updated_at = now() WHERE id = $2 AND organization_id = $3',
      [newStatus, req.params.id!, orgId],
    );
    void auditLog({ organizationId: orgId, userId: req.user!.id, action: enabled ? 'PROCESS_MONITORING_ENABLED' : 'PROCESS_MONITORING_PAUSED', entity: 'case', entityId: req.params.id, after: { monitoringStatus: newStatus }, ip: req.ip });
    res.json({ id: req.params.id, monitoring_status: newStatus });
  } catch (err) { next(err); }
});

router.post('/:id/events', async (req, res, next) => {
  try {
    await assertPermission(req, req.params.id!, 'edit');
    const orgId = getOrgId(req);
    const data = createEventSchema.parse(req.body);
    await addEvent({
      processId: req.params.id!,
      type: data.type,
      title: data.title,
      description: data.description,
      source: data.source ?? 'manual',
      sourceReference: data.sourceReference,
      createdBy: req.user!.id,
    });
    void auditLog({ organizationId: orgId, userId: req.user!.id, action: 'CASE_EVENT_ADDED', entity: 'case_event', entityId: req.params.id, after: { type: data.type, title: data.title }, ip: req.ip });
    res.status(201).json({ ok: true });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.post('/:id/members', async (req, res, next) => {
  try {
    await assertPermission(req, req.params.id!, 'manage');
    const orgId = getOrgId(req);
    const data = addMemberSchema.parse(req.body);
    const member = await caseService.addCaseMember(orgId, req.params.id!, data.userId, data.role, req.user!.id, req.ip);
    res.status(201).json(member);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.patch('/:id/members/:userId', async (req, res, next) => {
  try {
    await assertPermission(req, req.params.id!, 'manage');
    const orgId = getOrgId(req);
    const data = updateCaseMemberPermissionsSchema.parse(req.body);
    const member = await caseService.updateCaseMemberPermissions(orgId, req.params.id!, req.params.userId!, data, req.user!.id, req.ip);
    res.json(member);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.delete('/:id/members/:userId', async (req, res, next) => {
  try {
    await assertPermission(req, req.params.id!, 'manage');
    const orgId = getOrgId(req);
    const result = await caseService.removeCaseMember(orgId, req.params.id!, req.params.userId!, req.user!.id, req.ip);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
