import { Router } from 'express';
import type { Request } from 'express';
import { createTaskSchema, updateTaskSchema } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId, requirePermission } from '../auth/middleware';
import { PERMISSIONS } from '@advogado/shared';
import * as taskService from '../services/taskService';
import { assertCasePermission } from '../services/caseService';

async function checkProcessEdit(req: Request, processId: string | null | undefined) {
  if (processId) {
    await assertCasePermission(getOrgId(req), processId, req.user!.id, 'edit', req.user!.role);
  }
}

async function checkTaskProcessAccess(req: Request, taskId: string, required: 'view' | 'edit') {
  const orgId = getOrgId(req);
  const task = await taskService.getTask(orgId, taskId);
  if (task.process_id) {
    await assertCasePermission(orgId, task.process_id, req.user!.id, required, req.user!.role);
  }
  return task;
}

const router = Router();

router.use(requireAuth, requireOrg);

router.get('/', requirePermission(PERMISSIONS.TASKS_READ), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const view = typeof req.query.view === 'string' ? req.query.view : undefined;
    const result = await taskService.listTasks(orgId, {
      view,
      processId: typeof req.query.processId === 'string' ? req.query.processId : undefined,
      assignedTo: typeof req.query.assignedTo === 'string' ? req.query.assignedTo : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/summary', requirePermission(PERMISSIONS.TASKS_READ), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const summary = await taskService.getTasksByView(orgId);
    res.json(summary);
  } catch (err) { next(err); }
});

router.post('/', requirePermission(PERMISSIONS.TASKS_CREATE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = createTaskSchema.parse(req.body);
    await checkProcessEdit(req, data.processId ?? null);
    const task = await taskService.createTask(orgId, data, req.user!.id, req.ip);
    res.status(201).json(task);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = updateTaskSchema.parse(req.body);
    await checkTaskProcessAccess(req, req.params.id!, 'edit');
    const task = await taskService.updateTask(orgId, req.params.id!, data, req.user!.id, req.ip);
    res.json(task);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

export default router;