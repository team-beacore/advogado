import { getPool } from '../db/client';

export interface TimelineEvent {
  processId: string;
  type: string;
  title: string;
  description?: string | null;
  source?: string | null;
  sourceReference?: string | null;
  createdBy?: string | null;
}

export async function addEvent(event: TimelineEvent): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO case_events (process_id, type, title, description, source, source_reference, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [event.processId, event.type, event.title, event.description ?? null, event.source ?? null, event.sourceReference ?? null, event.createdBy ?? null],
  );
}

export async function listEvents(processId: string, limit = 200): Promise<unknown[]> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT e.*, u.name AS created_by_name
     FROM case_events e
     LEFT JOIN users u ON u.id = e.created_by
     WHERE e.process_id = $1
     ORDER BY e.created_at DESC
     LIMIT $2`,
    [processId, limit],
  );
  return res.rows;
}
