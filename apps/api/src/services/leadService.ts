import { errors } from '../errors';
import { getPool } from '../db/client';
import { auditLog } from '../audit/audit';

export interface LeadInput {
  name: string;
  phone?: string | null;
  source?: string | null;
  subject?: string | null;
  status?: string;
  assignedTo?: string | null;
}

export async function createLead(organizationId: string, input: LeadInput, userId: string, ip?: string) {
  const pool = getPool();
  if (input.assignedTo) {
    const memberRes = await pool.query('SELECT id FROM organization_members WHERE organization_id = $1 AND user_id = $2', [organizationId, input.assignedTo]);
    if (memberRes.rows.length === 0) throw errors.validation('Responsável não pertence à organização.');
  }
  const res = await pool.query(
    `INSERT INTO leads (organization_id, name, phone, source, subject, status, assigned_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [organizationId, input.name, input.phone ?? null, input.source ?? null, input.subject ?? null, input.status ?? 'NEW', input.assignedTo ?? null],
  );
  const lead = res.rows[0];
  void auditLog({ organizationId, userId, action: 'LEAD_CREATED', entity: 'lead', entityId: lead.id, after: { name: lead.name, status: lead.status }, ip });
  return lead;
}

export async function updateLead(organizationId: string, leadId: string, input: Partial<LeadInput>, userId: string, ip?: string) {
  const pool = getPool();
  const before = await pool.query('SELECT * FROM leads WHERE id = $1 AND organization_id = $2', [leadId, organizationId]);
  if (before.rows.length === 0) throw errors.notFound('Lead não encontrado.');
  const old = before.rows[0];
  const res = await pool.query(
    `UPDATE leads SET
       name = COALESCE($2, name),
       phone = $3,
       source = $4,
       subject = $5,
       status = COALESCE($6, status),
       assigned_to = $7,
       updated_at = now()
     WHERE id = $1 AND organization_id = $8 RETURNING *`,
    [leadId, input.name, input.phone ?? null, input.source ?? null, input.subject ?? null, input.status, input.assignedTo ?? null, organizationId],
  );
  void auditLog({ organizationId, userId, action: 'LEAD_UPDATED', entity: 'lead', entityId: leadId, before: old, after: res.rows[0], ip });
  return res.rows[0];
}

export async function listLeads(organizationId: string, opts: { status?: string; search?: string; page?: number; pageSize?: number }) {
  const pool = getPool();
  const params: unknown[] = [organizationId];
  let where = 'l.organization_id = $1';
  if (opts.status) {
    params.push(opts.status);
    where += ` AND l.status = $${params.length}`;
  }
  if (opts.search) {
    params.push(`%${opts.search}%`);
    where += ` AND l.name ILIKE $${params.length}`;
  }
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;
  params.push(pageSize, (page - 1) * pageSize);
  const res = await pool.query(
    `SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
     WHERE ${where} ORDER BY l.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: res.rows, page, pageSize };
}

/**
 * Converte um lead em cliente REAL, preservando o histórico
 * e mantendo o vínculo (converted_client_id).
 */
export async function convertLeadToClient(organizationId: string, leadId: string, userId: string, ip?: string, clientName?: string) {
  const pool = getPool();
  const leadRes = await pool.query('SELECT * FROM leads WHERE id = $1 AND organization_id = $2', [leadId, organizationId]);
  if (leadRes.rows.length === 0) throw errors.notFound('Lead não encontrado.');
  const lead = leadRes.rows[0];

  const clientRes = await pool.query(
    `INSERT INTO clients (organization_id, name, email, phone, notes)
     VALUES ($1, $2, NULL, $3, $4) RETURNING *`,
    [organizationId, clientName ?? lead.name, lead.phone ?? null, lead.subject ? `Assunto do lead: ${lead.subject}` : null],
  );
  const client = clientRes.rows[0];

  await pool.query('UPDATE leads SET status = $1, converted_client_id = $2, updated_at = now() WHERE id = $3', ['WON', client.id, leadId]);
  void auditLog({
    organizationId,
    userId,
    action: 'LEAD_CONVERTED_TO_CLIENT',
    entity: 'lead',
    entityId: leadId,
    after: { clientId: client.id, status: 'WON' },
    metadata: { convertedFrom: 'LEAD' },
    ip,
  });
  return { lead: { ...lead, status: 'WON', converted_client_id: client.id }, client };
}
