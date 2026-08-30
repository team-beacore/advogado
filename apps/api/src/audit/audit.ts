import { getPool } from '../db/client';

export interface AuditEntry {
  organizationId: string | null;
  userId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function auditLog(entry: AuditEntry): Promise<void> {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, entity, entity_id, before, after, ip, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.organizationId,
        entry.userId,
        entry.action,
        entry.entity,
        entry.entityId ?? null,
        entry.before ? JSON.stringify(entry.before) : null,
        entry.after ? JSON.stringify(entry.after) : null,
        entry.ip ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      ],
    );
  } catch {
    // Auditoria nunca deve derrubar a operação principal.
  }
}

export async function listAuditLogs(organizationId: string, options: { page?: number; pageSize?: number; action?: string; entity?: string }) {
  const pool = getPool();
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 50;
  const params: unknown[] = [organizationId];
  const conditions = ['organization_id = $1'];
  if (options.action) {
    params.push(options.action);
    conditions.push(`action = $${params.length}`);
  }
  if (options.entity) {
    params.push(options.entity);
    conditions.push(`entity = $${params.length}`);
  }
  params.push(pageSize);
  params.push((page - 1) * pageSize);
  const where = conditions.join(' AND ');
  const res = await pool.query(
    `SELECT l.*, u.name AS user_name
     FROM audit_logs l
     LEFT JOIN users u ON u.id = l.user_id
     WHERE ${where}
     ORDER BY l.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const countRes = await pool.query(`SELECT count(*)::int AS total FROM audit_logs WHERE ${where}`, params.slice(0, conditions.length));
  return {
    items: res.rows,
    total: countRes.rows[0]?.total ?? 0,
    page,
    pageSize,
  };
}
