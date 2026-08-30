import { errors } from '../errors';
import { getPool } from '../db/client';
import { auditLog } from '../audit/audit';
import { addEvent } from '../events/timeline';

export interface PublicationInput {
  processId: string;
  source?: string | null;
  availabilityDate?: string | null;
  publicationDate?: string | null;
  content: string;
  externalReference?: string | null;
  status?: string;
  possibleDueDate?: string | null;
  notes?: string | null;
}

export async function createPublication(organizationId: string, input: PublicationInput, userId: string | null, ip?: string) {
  const pool = getPool();
  const processRes = await pool.query('SELECT id, title FROM cases WHERE id = $1 AND organization_id = $2', [input.processId, organizationId]);
  if (processRes.rows.length === 0) throw errors.validation('Processo inválido para esta organização.');
  const processRow = processRes.rows[0];

  const res = await pool.query(
    `INSERT INTO legal_publications (organization_id, process_id, source, availability_date, publication_date, content, external_reference, status, possible_due_date, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      organizationId,
      input.processId,
      input.source ?? null,
      input.availabilityDate ? new Date(input.availabilityDate).toISOString() : null,
      input.publicationDate ? new Date(input.publicationDate).toISOString() : null,
      input.content,
      input.externalReference ?? null,
      input.status ?? 'PENDING',
      input.possibleDueDate ? new Date(input.possibleDueDate).toISOString() : null,
      input.notes ?? null,
      userId,
    ],
  );
  const pub = res.rows[0];

  await addEvent({
    processId: input.processId,
    type: 'PUBLICATION_REGISTERED',
    title: 'Intimação registrada',
    description: `Intimação ${input.source ? `de ${input.source} ` : ''}registrada para o processo "${processRow.title}".`,
    source: input.source ?? 'internal',
    sourceReference: pub.id,
    createdBy: userId,
  });

  if (input.possibleDueDate || input.status === 'PENDING') {
    const due = input.possibleDueDate ? new Date(input.possibleDueDate) : null;
    const notifRes = await pool.query(
      `INSERT INTO notifications (organization_id, process_id, user_id, type, title, description, status)
       VALUES ($1, $2, $3, 'PUBLICATION_PENDING', $4, $5, 'PENDING') RETURNING *`,
      [
        organizationId,
        input.processId,
        userId,
        'Intimação pendente de análise',
        `Uma intimação registrada em ${new Date().toLocaleDateString('pt-BR')} aguarda análise.${due ? ` Prazo possível: ${due.toLocaleDateString('pt-BR')}.` : ''}`,
      ],
    );
    const notif = notifRes.rows[0];
    if (userId) {
      try {
        const userRes = await pool.query('SELECT id, email FROM users WHERE id = $1', [userId]);
        const user = userRes.rows[0];
        const { dispatchNotification } = await import('../notify/service');
        void dispatchNotification(organizationId, notif.id, {
          userId,
          recipientEmail: user?.email ?? null,
          recipientPhone: null,
          title: notif.title,
          description: notif.description,
        });
      } catch {
        // envio por canal nunca deve derrubar o registro da intimação
      }
    }
  }

  void auditLog({ organizationId, userId, action: 'PUBLICATION_REGISTERED', entity: 'legal_publication', entityId: pub.id, after: { processId: input.processId, source: input.source, status: pub.status }, ip });
  return pub;
}

export async function getPublication(organizationId: string, publicationId: string) {
  const pool = getPool();
  const res = await pool.query('SELECT * FROM legal_publications WHERE id = $1 AND organization_id = $2', [publicationId, organizationId]);
  if (res.rows.length === 0) throw errors.notFound('Intimação não encontrada.');
  return res.rows[0];
}

export async function updatePublication(organizationId: string, publicationId: string, input: Partial<PublicationInput>, userId: string, ip?: string) {
  const pool = getPool();
  const before = await pool.query('SELECT * FROM legal_publications WHERE id = $1 AND organization_id = $2', [publicationId, organizationId]);
  if (before.rows.length === 0) throw errors.notFound('Intimação não encontrada.');
  const old = before.rows[0];
  const res = await pool.query(
    `UPDATE legal_publications SET
       source = $2,
       availability_date = $3,
       publication_date = $4,
       content = COALESCE($5, content),
       external_reference = $6,
       status = COALESCE($7, status),
       possible_due_date = $8,
       notes = $9,
       updated_at = now()
     WHERE id = $1 AND organization_id = $10 RETURNING *`,
    [
      publicationId,
      input.source ?? null,
      input.availabilityDate ? new Date(input.availabilityDate).toISOString() : null,
      input.publicationDate ? new Date(input.publicationDate).toISOString() : null,
      input.content,
      input.externalReference ?? null,
      input.status,
      input.possibleDueDate ? new Date(input.possibleDueDate).toISOString() : null,
      input.notes ?? null,
      organizationId,
    ],
  );
  const updated = res.rows[0];
  if (old.status === 'PENDING' && updated.status === 'PROCESSED') {
    await pool.query(`UPDATE notifications SET status = 'READ', read_at = now() WHERE process_id = $1 AND type = 'PUBLICATION_PENDING'`, [updated.process_id]);
  }
  void auditLog({ organizationId, userId, action: 'PUBLICATION_UPDATED', entity: 'legal_publication', entityId: publicationId, before: old, after: updated, ip });
  return updated;
}

export async function listPublications(organizationId: string, opts: { processId?: string; status?: string; page?: number; pageSize?: number }) {
  const pool = getPool();
  const params: unknown[] = [organizationId];
  let where = 'p.organization_id = $1';
  if (opts.processId) {
    params.push(opts.processId);
    where += ` AND p.process_id = $${params.length}`;
  }
  if (opts.status) {
    params.push(opts.status);
    where += ` AND p.status = $${params.length}`;
  }
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;
  params.push(pageSize, (page - 1) * pageSize);
  const res = await pool.query(
    `SELECT p.*, c.title AS process_title, c.process_number AS process_number
     FROM legal_publications p LEFT JOIN cases c ON c.id = p.process_id
     WHERE ${where}
     ORDER BY p.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: res.rows, page, pageSize };
}

export async function getPendingPublicationCount(organizationId: string): Promise<number> {
  const pool = getPool();
  const res = await pool.query('SELECT count(*)::int AS count FROM legal_publications WHERE organization_id = $1 AND status = $2', [organizationId, 'PENDING']);
  return res.rows[0]?.count ?? 0;
}
