import { Router } from 'express';
import { createCaseSchema, updateCaseSchema, listCasesQuerySchema, addMemberSchema, createEventSchema, updateCaseMemberPermissionsSchema } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId } from '../auth/middleware';
import * as caseService from '../services/caseService';
import { addEvent, listEvents } from '../events/timeline';
import { auditLog } from '../audit/audit';

const router = Router();

router.use(requireAuth, requireOrg);

async function assertPermission(req: Parameters<typeof getOrgId>[0], caseId: string, required: 'view' | 'edit' | 'manage') {
  const orgId = getOrgId(req);
  await caseService.assertCasePermission(orgId, caseId, req.user!.id, required, req.user!.role);
}

router.get('/', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const q = listCasesQuerySchema.parse(req.query);
    const result = await caseService.listCases(orgId, {
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

router.post('/', async (req, res, next) => {
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
