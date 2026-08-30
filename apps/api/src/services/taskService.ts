import { errors } from '../errors';
import { getPool } from '../db/client';
import { auditLog } from '../audit/audit';
import { addEvent } from '../events/timeline';

export interface TaskInput {
  processId?: string | null;
  title: string;
  description?: string | null;
  priority?: string;
  status?: string;
  dueDate?: string | null;
  assignedTo?: string | null;
}

export async function createTask(organizationId: string, input: TaskInput, userId: string, ip?: string) {
  const pool = getPool();
  if (input.processId) {
    const processRes = await pool.query('SELECT id FROM cases WHERE id = $1 AND organization_id = $2', [input.processId, organizationId]);
    if (processRes.rows.length === 0) throw errors.validation('Processo inválido para esta organização.');
  }
  if (input.assignedTo) {
    const memberRes = await pool.query('SELECT id FROM organization_members WHERE organization_id = $1 AND user_id = $2', [organizationId, input.assignedTo]);
    if (memberRes.rows.length === 0) throw errors.validation('Responsável não pertence à organização.');
  }
  const res = await pool.query(
    `INSERT INTO tasks (organization_id, process_id, title, description, priority, status, due_date, assigned_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      organizationId,
      input.processId ?? null,
      input.title,
      input.description ?? null,
      input.priority ?? 'MEDIUM',
      input.status ?? 'TODO',
      input.dueDate ? new Date(input.dueDate).toISOString() : null,
      input.assignedTo ?? null,
      userId,
    ],
  );
  const task = res.rows[0];
  if (input.processId) {
    await addEvent({
      processId: input.processId,
      type: 'TASK_CREATED',
      title: 'Tarefa criada',
      description: `Tarefa "${input.title}" criada.`,
      source: 'internal',
      sourceReference: task.id,
      createdBy: userId,
    });
  }
  void auditLog({ organizationId, userId, action: 'TASK_CREATED', entity: 'task', entityId: task.id, after: { title: input.title, priority: task.priority, dueDate: task.due_date }, ip });
  return task;
}

export async function getTask(organizationId: string, taskId: string) {
  const pool = getPool();
  const res = await pool.query('SELECT * FROM tasks WHERE id = $1 AND organization_id = $2', [taskId, organizationId]);
  if (res.rows.length === 0) throw errors.notFound('Tarefa não encontrada.');
  return res.rows[0];
}

export async function updateTask(organizationId: string, taskId: string, input: Partial<TaskInput>, userId: string, ip?: string) {
  const pool = getPool();
  const before = await pool.query('SELECT * FROM tasks WHERE id = $1 AND organization_id = $2', [taskId, organizationId]);
  if (before.rows.length === 0) throw errors.notFound('Tarefa não encontrada.');
  const old = before.rows[0];
  const res = await pool.query(
    `UPDATE tasks SET
       process_id = COALESCE($2, process_id),
       title = COALESCE($3, title),
       description = $4,
       priority = COALESCE($5, priority),
       status = COALESCE($6, status),
       due_date = $7,
       assigned_to = $8,
       updated_at = now()
     WHERE id = $1 AND organization_id = $9 RETURNING *`,
    [
      taskId,
      input.processId ?? null,
      input.title,
      input.description ?? null,
      input.priority,
      input.status,
      input.dueDate ? new Date(input.dueDate).toISOString() : null,
      input.assignedTo ?? null,
      organizationId,
    ],
  );
  const updated = res.rows[0];
  if (old.status !== updated.status && old.status === 'TODO' && updated.status === 'DONE') {
    if (updated.process_id) {
      await addEvent({
        processId: updated.process_id,
        type: 'TASK_COMPLETED',
        title: 'Tarefa concluída',
        description: `Tarefa "${updated.title}" foi concluída.`,
        source: 'internal',
        sourceReference: updated.id,
        createdBy: userId,
      });
    }
  }
  void auditLog({ organizationId, userId, action: 'TASK_UPDATED', entity: 'task', entityId: taskId, before: old, after: updated, ip });
  return updated;
}

export async function listTasks(
  organizationId: string,
  opts: { view?: string; processId?: string; assignedTo?: string; status?: string; page?: number; pageSize?: number },
) {
  const pool = getPool();
  const params: unknown[] = [organizationId];
  let where = 't.organization_id = $1';
  if (opts.processId) {
    params.push(opts.processId);
    where += ` AND t.process_id = $${params.length}`;
  }
  if (opts.assignedTo) {
    params.push(opts.assignedTo);
    where += ` AND t.assigned_to = $${params.length}`;
  }
  if (opts.status) {
    params.push(opts.status);
    where += ` AND t.status = $${params.length}`;
  }

  const now = new Date();
  let dateFilter = '';
  if (opts.view === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    params.push(start.toISOString(), end.toISOString());
    dateFilter = ` AND t.status IN ('TODO','IN_PROGRESS') AND t.due_date IS NOT NULL AND t.due_date >= $${params.length - 1} AND t.due_date < $${params.length}`;
  } else if (opts.view === 'overdue') {
    params.push(now.toISOString());
    dateFilter = ` AND t.status IN ('TODO','IN_PROGRESS') AND t.due_date IS NOT NULL AND t.due_date < $${params.length}`;
  } else if (opts.view === 'upcoming') {
    params.push(now.toISOString());
    dateFilter = ` AND t.status IN ('TODO','IN_PROGRESS') AND (t.due_date IS NULL OR t.due_date >= $${params.length})`;
  } else if (opts.view === 'done') {
    dateFilter = ` AND t.status = 'DONE'`;
  } else {
    dateFilter = ` AND t.status IN ('TODO','IN_PROGRESS')`;
  }

  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;
  params.push(pageSize, (page - 1) * pageSize);
  const res = await pool.query(
    `SELECT t.*, u.name AS assigned_name, c.title AS process_title, c.process_number AS process_number
     FROM tasks t
     LEFT JOIN users u ON u.id = t.assigned_to
     LEFT JOIN cases c ON c.id = t.process_id
     WHERE ${where}${dateFilter}
     ORDER BY (t.status = 'DONE') ASC, t.due_date ASC NULLS LAST, t.priority DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: res.rows, page, pageSize };
}

export async function getTasksByView(organizationId: string) {
  const pool = getPool();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  const [today, overdue, upcoming, done] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS count FROM tasks WHERE organization_id = $1 AND status IN ('TODO','IN_PROGRESS') AND due_date IS NOT NULL AND due_date >= $2 AND due_date < $3`,
      [organizationId, startOfDay.toISOString(), endOfDay.toISOString()],
    ),
    pool.query(
      `SELECT count(*)::int AS count FROM tasks WHERE organization_id = $1 AND status IN ('TODO','IN_PROGRESS') AND due_date IS NOT NULL AND due_date < $2`,
      [organizationId, now.toISOString()],
    ),
    pool.query(
      `SELECT count(*)::int AS count FROM tasks WHERE organization_id = $1 AND status IN ('TODO','IN_PROGRESS') AND (due_date IS NULL OR due_date >= $2)`,
      [organizationId, now.toISOString()],
    ),
    pool.query(`SELECT count(*)::int AS count FROM tasks WHERE organization_id = $1 AND status = 'DONE'`, [organizationId]),
  ]);
  return {
    today: today.rows[0]?.count ?? 0,
    overdue: overdue.rows[0]?.count ?? 0,
    upcoming: upcoming.rows[0]?.count ?? 0,
    done: done.rows[0]?.count ?? 0,
  };
}
