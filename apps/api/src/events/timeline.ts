import { getPool } from '../db/client';

export interface TimelineEvent {
  processId: string;
  type: string;
  title: string;
  description?: string | null;
  source?: string | null;
  sourceReference?: string | null;
  createdBy?: string | null;
  /** Data/hora do evento NA FONTE (movimentação) — não é o created_at da aplicação. */
  occurredAt?: string | null;
  /** Código da movimentação na fonte (ex.: movimentos.codigo). */
  eventCode?: string | number | null;
  /** Nome da movimentação na fonte (ex.: movimentos.nome). */
  eventName?: string | null;
  /** Metadados estruturados (complementosTabelados, metadados da fonte). */
  eventMetadata?: Record<string, unknown> | null;
}

export async function addEvent(event: TimelineEvent): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO case_events (process_id, type, title, description, source, source_reference, created_by, occurred_at, event_code, event_name, event_metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      event.processId,
      event.type,
      event.title,
      event.description ?? null,
      event.source ?? null,
      event.sourceReference ?? null,
      event.createdBy ?? null,
      event.occurredAt ? new Date(event.occurredAt).toISOString() : null,
      event.eventCode != null ? String(event.eventCode) : null,
      event.eventName ?? null,
      event.eventMetadata ? JSON.stringify(event.eventMetadata) : null,
    ],
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
