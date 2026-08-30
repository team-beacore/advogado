import { getPool } from '../db/client';

export async function getDashboard(organizationId: string) {
  const pool = getPool();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [activeCases, pendingTasks, overdueTasks, pendingPublications, recentActivities] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS count FROM cases WHERE organization_id = $1 AND status IN ('ACTIVE', 'SUSPENDED')`,
      [organizationId],
    ),
    pool.query(
      `SELECT count(*)::int AS count FROM tasks WHERE organization_id = $1 AND status IN ('TODO', 'IN_PROGRESS')`,
      [organizationId],
    ),
    pool.query(
      `SELECT count(*)::int AS count FROM tasks WHERE organization_id = $1 AND status IN ('TODO', 'IN_PROGRESS') AND due_date IS NOT NULL AND due_date < $2`,
      [organizationId, now.toISOString()],
    ),
    pool.query(
      `SELECT count(*)::int AS count FROM legal_publications WHERE organization_id = $1 AND status = 'PENDING'`,
      [organizationId],
    ),
    pool.query(
      `(SELECT 'event' AS kind, e.id, e.title AS title, e.created_at, e.process_id, c.title AS process_title
         FROM case_events e JOIN cases c ON c.id = e.process_id
        WHERE c.organization_id = $1 ORDER BY e.created_at DESC LIMIT 10)
       UNION ALL
       (SELECT 'audit' AS kind, l.id, l.action AS title, l.created_at, NULL::uuid AS process_id, NULL::text AS process_title
         FROM audit_logs l WHERE l.organization_id = $1 ORDER BY l.created_at DESC LIMIT 10)
       ORDER BY created_at DESC LIMIT 15`,
      [organizationId],
    ),
  ]);

  const [todayTasks, upcomingTasks, financeSummary] = await Promise.all([
    pool.query(
      `SELECT t.*, c.title AS process_title FROM tasks t LEFT JOIN cases c ON c.id = t.process_id
       WHERE t.organization_id = $1 AND t.status IN ('TODO','IN_PROGRESS') AND t.due_date IS NOT NULL
         AND t.due_date >= $2 AND t.due_date < $2 + interval '1 day'
       ORDER BY t.due_date ASC LIMIT 10`,
      [organizationId, startOfDay.toISOString()],
    ),
    pool.query(
      `SELECT t.*, c.title AS process_title FROM tasks t LEFT JOIN cases c ON c.id = t.process_id
       WHERE t.organization_id = $1 AND t.status IN ('TODO','IN_PROGRESS') AND (t.due_date IS NULL OR t.due_date >= $2)
       ORDER BY t.due_date ASC NULLS LAST LIMIT 10`,
      [organizationId, now.toISOString()],
    ),
    pool.query(
      `SELECT
         (SELECT COALESCE(sum(amount), 0)::numeric FROM invoices WHERE organization_id = $1 AND status IN ('PENDING','OVERDUE')) AS receivable_total,
         (SELECT count(*)::int FROM invoices WHERE organization_id = $1 AND status IN ('PENDING','OVERDUE')) AS receivable_count,
         (SELECT COALESCE(sum(amount), 0)::numeric FROM payments WHERE organization_id = $1 AND status = 'PAID') AS received_total`,
      [organizationId],
    ),
  ]);

  const finance = financeSummary.rows[0] ?? {};
  return {
    counts: {
      activeCases: activeCases.rows[0]?.count ?? 0,
      pendingTasks: pendingTasks.rows[0]?.count ?? 0,
      overdueTasks: overdueTasks.rows[0]?.count ?? 0,
      pendingPublications: pendingPublications.rows[0]?.count ?? 0,
    },
    todayTasks: todayTasks.rows,
    upcomingTasks: upcomingTasks.rows,
    recentActivities: recentActivities.rows,
    finance: {
      receivableTotal: Number(finance.receivable_total ?? 0),
      receivableCount: finance.receivable_count ?? 0,
      receivedTotal: Number(finance.received_total ?? 0),
    },
  };
}
