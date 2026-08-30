import { errors } from '../errors';
import { getPool } from '../db/client';
import { auditLog } from '../audit/audit';

export interface ClientInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  cpfCnpj?: string | null;
  notes?: string | null;
}

export async function createClient(organizationId: string, input: ClientInput, userId: string, ip?: string) {
  const pool = getPool();
  const res = await pool.query(
    `INSERT INTO clients (organization_id, name, email, phone, cpf_cnpj, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [organizationId, input.name, input.email ?? null, input.phone ?? null, input.cpfCnpj ?? null, input.notes ?? null],
  );
  const client = res.rows[0];
  void auditLog({ organizationId, userId, action: 'CLIENT_CREATED', entity: 'client', entityId: client.id, after: { name: client.name }, ip });
  return client;
}

export async function updateClient(organizationId: string, clientId: string, input: Partial<ClientInput>, userId: string, ip?: string) {
  const pool = getPool();
  const before = await pool.query('SELECT * FROM clients WHERE id = $1 AND organization_id = $2', [clientId, organizationId]);
  if (before.rows.length === 0) throw errors.notFound('Cliente não encontrado.');
  const res = await pool.query(
    `UPDATE clients SET name = COALESCE($2, name), email = $3, phone = $4, cpf_cnpj = $5, notes = $6, updated_at = now()
     WHERE id = $1 AND organization_id = $7 RETURNING *`,
    [clientId, input.name, input.email ?? null, input.phone ?? null, input.cpfCnpj ?? null, input.notes ?? null, organizationId],
  );
  void auditLog({ organizationId, userId, action: 'CLIENT_UPDATED', entity: 'client', entityId: clientId, before: before.rows[0], after: res.rows[0], ip });
  return res.rows[0];
}

export async function getClient(organizationId: string, clientId: string) {
  const pool = getPool();
  const res = await pool.query('SELECT * FROM clients WHERE id = $1 AND organization_id = $2', [clientId, organizationId]);
  if (res.rows.length === 0) throw errors.notFound('Cliente não encontrado.');
  return res.rows[0];
}

export async function listClients(organizationId: string, search?: string, page = 1, pageSize = 20) {
  const pool = getPool();
  const params: unknown[] = [organizationId];
  let where = 'c.organization_id = $1';
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (c.name ILIKE $${params.length} OR COALESCE(c.email,'') ILIKE $${params.length} OR COALESCE(c.phone,'') ILIKE $${params.length} OR COALESCE(c.cpf_cnpj,'') ILIKE $${params.length})`;
  }
  params.push(pageSize, (page - 1) * pageSize);
  const res = await pool.query(
    `SELECT c.*, (SELECT count(*)::int FROM cases k WHERE k.client_id = c.id AND k.organization_id = c.organization_id) AS case_count
     FROM clients c WHERE ${where}
     ORDER BY c.name ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const countRes = await pool.query(`SELECT count(*)::int AS total FROM clients c WHERE ${where}`, params.slice(0, params.length - 2));
  return { items: res.rows, total: countRes.rows[0]?.total ?? 0, page, pageSize };
}

export async function getClientCases(organizationId: string, clientId: string): Promise<unknown[]> {
  const pool = getPool();
  await getClient(organizationId, clientId);
  const res = await pool.query(
    `SELECT id, title, process_number, court, area, status, created_at FROM cases
     WHERE client_id = $1 AND organization_id = $2 ORDER BY created_at DESC`,
    [clientId, organizationId],
  );
  return res.rows;
}

export async function getClientDocuments(organizationId: string, clientId: string): Promise<unknown[]> {
  const pool = getPool();
  await getClient(organizationId, clientId);
  const res = await pool.query(
    `SELECT d.id, d.name, d.file_name, d.mime_type, d.size, d.created_at, d.process_id, c.title AS process_title
     FROM documents d LEFT JOIN cases c ON c.id = d.process_id
     WHERE d.client_id = $1 AND d.organization_id = $2 AND d.deleted_at IS NULL
     ORDER BY d.created_at DESC`,
    [clientId, organizationId],
  );
  return res.rows;
}
