import { getPool } from '../db/client';

export async function listNotifications(organizationId: string, opts: { status?: string; page?: number; pageSize?: number }) {
  const pool = getPool();
  const params: unknown[] = [organizationId];
  let where = 'n.organization_id = $1';
  if (opts.status) {
    params.push(opts.status);
    where += ` AND n.status = $${params.length}`;
  }
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;
  params.push(pageSize, (page - 1) * pageSize);
  const res = await pool.query(
    `SELECT n.*, c.title AS process_title FROM notifications n LEFT JOIN cases c ON c.id = n.process_id
     WHERE ${where} ORDER BY n.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: res.rows, page, pageSize };
}

export async function markNotificationRead(organizationId: string, notificationId: string, userId: string | null) {
  const pool = getPool();
  const res = await pool.query(
    `UPDATE notifications SET status = 'READ', read_at = now()
     WHERE id = $1 AND organization_id = $2 AND (user_id IS NULL OR user_id = $3 OR $4)
     RETURNING *`,
    [notificationId, organizationId, userId ?? '', userId === null],
  );
  return res.rows[0] ?? null;
}

export async function getPendingNotificationCount(organizationId: string): Promise<number> {
  const pool = getPool();
  const res = await pool.query('SELECT count(*)::int AS count FROM notifications WHERE organization_id = $1 AND status = $2', [organizationId, 'PENDING']);
  return res.rows[0]?.count ?? 0;
}
