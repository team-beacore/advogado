import { randomBytes, createHash } from 'node:crypto';
import { errors } from '../errors';
import { getPool } from '../db/client';
import { auditLog } from '../audit/audit';
import { ScryptHasher } from '../auth/password';

const hasher = new ScryptHasher();
const CLIENT_COOKIE_NAME = 'advogado_client_session';

export function clientCookieName(): string {
  return CLIENT_COOKIE_NAME;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function generateTemporaryPassword(): Promise<string> {
  return randomBytes(8).toString('base64url');
}

/** Cria (ou reutiliza) a identidade de acesso do cliente no portal. */
export async function inviteClientToPortal(organizationId: string, clientId: string, email: string, actorId: string, ip?: string) {
  const pool = getPool();
  const clientRes = await pool.query(
    'SELECT id, name, email, phone FROM clients WHERE id = $1 AND organization_id = $2',
    [clientId, organizationId],
  );
  if (clientRes.rows.length === 0) throw errors.notFound('Cliente não encontrado.');
  const client = clientRes.rows[0];
  const targetEmail = (email || client.email)?.trim().toLowerCase();
  if (!targetEmail) throw errors.validation('É necessário informar um e-mail para o portal do cliente.');

  const password = await generateTemporaryPassword();
  const passwordHash = hasher.hash(password);

  const res = await pool.query(
    `INSERT INTO client_users (organization_id, client_id, email, password_hash, status, updated_at)
     VALUES ($1, $2, $3, $4, 'INVITED', now())
     ON CONFLICT (client_id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, status = 'INVITED', updated_at = now()
     RETURNING *`,
    [organizationId, clientId, targetEmail, passwordHash],
  );
  const portal = res.rows[0];
  void auditLog({ organizationId, userId: actorId, action: 'CLIENT_PORTAL_INVITED', entity: 'client', entityId: clientId, after: { email: targetEmail, portalUserId: portal.id }, ip });
  // A senha temporária é retornada UMA única vez ao administrador, que a repassa ao cliente com segurança.
  return { id: portal.id, email: targetEmail, status: portal.status, temporaryPassword: password, client: { id: client.id, name: client.name } };
}

export async function revokeClientPortal(organizationId: string, clientId: string, actorId: string, ip?: string) {
  const pool = getPool();
  const res = await pool.query(
    'DELETE FROM client_users WHERE organization_id = $1 AND client_id = $2 RETURNING id',
    [organizationId, clientId],
  );
  if (res.rows.length === 0) throw errors.notFound('Cliente sem acesso ao portal.');
  void auditLog({ organizationId, userId: actorId, action: 'CLIENT_PORTAL_REVOKED', entity: 'client', entityId: clientId, after: { portalUserId: res.rows[0].id }, ip });
  return { ok: true };
}

export async function getClientPortal(organizationId: string, clientId: string) {
  const pool = getPool();
  const res = await pool.query(
    `SELECT cu.id, cu.email, cu.status, cu.last_login_at, cl.id AS client_id, cl.name AS client_name
     FROM client_users cu JOIN clients cl ON cl.id = cu.client_id
     WHERE cu.organization_id = $1 AND cu.client_id = $2`,
    [organizationId, clientId],
  );
  return res.rows[0] ?? null;
}

export async function loginClientPortal(email: string, password: string) {
  const pool = getPool();
  const res = await pool.query(
    `SELECT cu.*, cl.name AS client_name FROM client_users cu
     JOIN clients cl ON cl.id = cu.client_id
     WHERE cu.email = $1`,
    [email.toLowerCase()],
  );
  const portal = res.rows[0];
  if (!portal) throw errors.unauthorized('Email ou senha inválidos.');
  if (!hasher.verify(password, portal.password_hash)) {
    throw errors.unauthorized('Email ou senha inválidos.');
  }
  if (portal.status === 'DISABLED') throw errors.forbidden('Acesso ao portal desativado.');
  return portal;
}

export async function createClientSession(portalUserId: string, organizationId: string): Promise<string> {
  const pool = getPool();
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO client_sessions (client_user_id, organization_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '30 days')`,
    [portalUserId, organizationId, sha256Hex(token)],
  );
  await pool.query(`UPDATE client_users SET status = 'ACTIVE', last_login_at = now(), updated_at = now() WHERE id = $1`, [portalUserId]);
  return token;
}

export async function getClientSessionUser(token: string): Promise<{ portalUserId: string; organizationId: string } | null> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT id, client_user_id, organization_id, expires_at FROM client_sessions WHERE token_hash = $1`,
    [sha256Hex(token)],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await pool.query('DELETE FROM client_sessions WHERE id = $1', [row.id]);
    return null;
  }
  await pool.query('UPDATE client_sessions SET last_active_at = now() WHERE id = $1', [row.id]);
  return { portalUserId: row.client_user_id, organizationId: row.organization_id };
}

export async function destroyClientSession(token: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM client_sessions WHERE token_hash = $1', [sha256Hex(token)]);
}

export async function getPortalProfile(portalUserId: string, organizationId: string) {
  const pool = getPool();
  const res = await pool.query(
    `SELECT cu.id, cu.email, cu.status, cl.id AS client_id, cl.name AS client_name, cl.phone, cl.cpf_cnpj
     FROM client_users cu JOIN clients cl ON cl.id = cu.client_id
     WHERE cu.id = $1 AND cu.organization_id = $2`,
    [portalUserId, organizationId],
  );
  return res.rows[0] ?? null;
}

export async function listSharedCases(portalUserId: string, organizationId: string) {
  const pool = getPool();
  const res = await pool.query(
    `SELECT c.id, c.title, c.process_number, c.court, c.area, c.status, c.created_at,
            cca.can_view_documents
     FROM client_case_access cca
     JOIN client_users cu ON cu.client_id = cca.client_id
     JOIN cases c ON c.id = cca.case_id
     WHERE cu.id = $1 AND cca.organization_id = $2 AND c.organization_id = $2
     ORDER BY c.created_at DESC`,
    [portalUserId, organizationId],
  );
  return res.rows;
}

export async function getSharedCase(portalUserId: string, organizationId: string, caseId: string) {
  const pool = getPool();
  const res = await pool.query(
    `SELECT c.id, c.title, c.process_number, c.court, c.area, c.status, c.created_at, c.description,
            cca.can_view_documents
     FROM client_case_access cca
     JOIN client_users cu ON cu.client_id = cca.client_id
     JOIN cases c ON c.id = cca.case_id
     WHERE cu.id = $1 AND cca.organization_id = $2 AND c.id = $3`,
    [portalUserId, organizationId, caseId],
  );
  return res.rows[0] ?? null;
}

export async function listSharedCaseDocuments(portalUserId: string, organizationId: string, caseId: string) {
  const pool = getPool();
  const access = await getSharedCase(portalUserId, organizationId, caseId);
  if (!access) throw errors.notFound('Processo não compartilhado com este cliente.');
  if (!access.can_view_documents) throw errors.forbidden('Acesso a documentos não autorizado.');
  const res = await pool.query(
    `SELECT d.id, d.name, d.file_name, d.mime_type, d.size, d.created_at
     FROM documents d JOIN cases c ON c.id = d.process_id
     JOIN client_case_access cca ON cca.case_id = c.id
     JOIN client_users cu ON cu.client_id = cca.client_id
     WHERE d.process_id = $2 AND d.organization_id = $3 AND d.deleted_at IS NULL AND cu.id = $1
     ORDER BY d.created_at DESC`,
    [portalUserId, caseId, organizationId],
  );
  return res.rows;
}

/** Compartilha (ou atualiza) um processo com o cliente para acesso no portal. */
export async function shareCaseWithClient(organizationId: string, clientId: string, caseId: string, canViewDocuments: boolean, actorId: string, ip?: string) {
  const pool = getPool();
  const clientRes = await pool.query('SELECT id FROM clients WHERE id = $1 AND organization_id = $2', [clientId, organizationId]);
  if (clientRes.rows.length === 0) throw errors.notFound('Cliente não encontrado.');
  const caseRes = await pool.query('SELECT id FROM cases WHERE id = $1 AND organization_id = $2', [caseId, organizationId]);
  if (caseRes.rows.length === 0) throw errors.notFound('Processo não encontrado.');
  const res = await pool.query(
    `INSERT INTO client_case_access (organization_id, client_id, case_id, can_view_documents)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id, case_id) DO UPDATE SET can_view_documents = EXCLUDED.can_view_documents
     RETURNING *`,
    [organizationId, clientId, caseId, canViewDocuments],
  );
  void auditLog({ organizationId, userId: actorId, action: 'CLIENT_CASE_SHARED', entity: 'client_case_access', entityId: res.rows[0].id, after: { clientId, caseId, canViewDocuments }, ip });
  return res.rows[0];
}

export async function unshareCaseWithClient(organizationId: string, clientId: string, caseId: string, actorId: string, ip?: string) {
  const pool = getPool();
  const res = await pool.query(
    'DELETE FROM client_case_access WHERE organization_id = $1 AND client_id = $2 AND case_id = $3 RETURNING id',
    [organizationId, clientId, caseId],
  );
  if (res.rows.length === 0) throw errors.notFound('Compartilhamento não encontrado.');
  void auditLog({ organizationId, userId: actorId, action: 'CLIENT_CASE_UNSHARED', entity: 'client_case_access', entityId: res.rows[0].id, after: { clientId, caseId }, ip });
  return { ok: true };
}

export async function listClientShares(organizationId: string, clientId: string) {
  const pool = getPool();
  const res = await pool.query(
    `SELECT cca.case_id, c.title, c.process_number, c.status, cca.can_view_documents, cca.created_at
     FROM client_case_access cca JOIN cases c ON c.id = cca.case_id
     WHERE cca.organization_id = $1 AND cca.client_id = $2
     ORDER BY c.created_at DESC`,
    [organizationId, clientId],
  );
  return res.rows;
}