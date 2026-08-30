import { errors } from '../errors';
import { getPool } from '../db/client';
import { auditLog } from '../audit/audit';

export async function createOrganization(name: string, ownerUserId: string, ip?: string): Promise<Record<string, unknown>> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orgRes = await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING *', [name]);
    const org = orgRes.rows[0];
    await client.query(
      'INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)',
      [org.id, ownerUserId, 'ADMIN'],
    );
    await client.query('COMMIT');
    void auditLog({ organizationId: org.id, userId: ownerUserId, action: 'ORGANIZATION_CREATED', entity: 'organization', entityId: org.id, after: { name }, ip });
    return org;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listOrganizations(userId: string): Promise<unknown[]> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT o.id, o.name, o.created_at, om.role FROM organizations o
     JOIN organization_members om ON om.organization_id = o.id
     WHERE om.user_id = $1 ORDER BY o.created_at ASC`,
    [userId],
  );
  return res.rows;
}

export async function getMembership(organizationId: string, userId: string) {
  const pool = getPool();
  const res = await pool.query(
    'SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2',
    [organizationId, userId],
  );
  return res.rows[0] ?? null;
}

export async function assertMember(organizationId: string, userId: string): Promise<void> {
  const membership = await getMembership(organizationId, userId);
  if (!membership) throw errors.forbidden('Você não pertence a esta organização.');
}

export async function listOrganizationUsers(organizationId: string): Promise<unknown[]> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT u.id, u.name, u.email, om.role, om.created_at
     FROM organization_members om
     JOIN users u ON u.id = om.user_id
     WHERE om.organization_id = $1 ORDER BY u.name`,
    [organizationId],
  );
  return res.rows;
}

export async function addOrganizationUser(organizationId: string, email: string, role: 'ADMIN' | 'LAWYER' | 'ASSISTANT', actorId: string, ip?: string) {
  const pool = getPool();
  const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (userRes.rows.length === 0) throw errors.notFound('Usuário com este email não encontrado. Peça que ele crie uma conta.');
  const userId = userRes.rows[0].id;
  const existing = await pool.query(
    'SELECT id FROM organization_members WHERE organization_id = $1 AND user_id = $2',
    [organizationId, userId],
  );
  if (existing.rows.length > 0) throw errors.conflict('Usuário já pertence à organização.');
  await pool.query('INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)', [organizationId, userId, role]);
  void auditLog({ organizationId, userId: actorId, action: 'ORGANIZATION_MEMBER_ADDED', entity: 'organization_member', entityId: userId, after: { email, role }, ip });
  return { id: userId };
}

export async function updateMemberRole(organizationId: string, memberUserId: string, role: string, actorId: string, ip?: string) {
  const pool = getPool();
  const res = await pool.query(
    'UPDATE organization_members SET role = $1 WHERE organization_id = $2 AND user_id = $3 RETURNING role',
    [role, organizationId, memberUserId],
  );
  if (res.rows.length === 0) throw errors.notFound('Membro não encontrado.');
  void auditLog({ organizationId, userId: actorId, action: 'ORGANIZATION_MEMBER_ROLE_UPDATED', entity: 'organization_member', entityId: memberUserId, before: { role }, after: { role }, ip });
  return res.rows[0];
}
