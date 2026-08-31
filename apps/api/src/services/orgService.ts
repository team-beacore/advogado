import { randomBytes } from 'node:crypto';
import { errors } from '../errors';
import { getPool } from '../db/client';
import { auditLog } from '../audit/audit';
import type { InternalRole } from '@advogado/shared';
import { INTERNAL_ROLES } from '@advogado/shared';
import { ScryptHasher } from '../auth/password';

const hasher = new ScryptHasher();

export type PlanType = 'SOLO' | 'OFFICE';

export async function getOrganization(organizationId: string) {
  const pool = getPool();
  const res = await pool.query('SELECT * FROM organizations WHERE id = $1', [organizationId]);
  return res.rows[0] ?? null;
}

export async function getOrganizationPlan(organizationId: string): Promise<PlanType> {
  const org = await getOrganization(organizationId);
  return org?.plan_type === 'OFFICE' ? 'OFFICE' : 'SOLO';
}

/** Gera uma senha temporária aleatória criptograficamente adequada. */
export function generateTemporaryPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    const idx = bytes[i] ?? 0;
    out += chars[idx % chars.length];
  }
  return out;
}

export async function createOrganization(name: string, ownerUserId: string, ip?: string, plan: PlanType = 'OFFICE'): Promise<Record<string, unknown>> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orgRes = await client.query('INSERT INTO organizations (name, plan_type) VALUES ($1, $2) RETURNING *', [name, plan]);
    const org = orgRes.rows[0];
    await client.query(
      'INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)',
      [org.id, ownerUserId, 'ADMIN'],
    );
    await client.query('COMMIT');
    void auditLog({ organizationId: org.id, userId: ownerUserId, action: 'ORGANIZATION_CREATED', entity: 'organization', entityId: org.id, after: { name, plan }, ip });
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
    `SELECT o.id, o.name, o.plan_type, o.created_at, om.role FROM organizations o
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
    `SELECT u.id, u.name, u.email, u.phone, om.role, om.created_at
     FROM organization_members om
     JOIN users u ON u.id = om.user_id
     WHERE om.organization_id = $1 ORDER BY u.name`,
    [organizationId],
  );
  return res.rows;
}

/**
 * Adiciona um membro à organização.
 * - Cria o usuário automaticamente (com senha temporária aleatória) caso não exista.
 * - O ADMIN informa nome, email e role; o sistema gera a senha temporária.
 * - A senha é retornada UMA única vez (para o ADMIN repassar ao membro); só o hash é persistido.
 * Roles permitidos para membros: LAWYER, ASSISTANT, FINANCE.
 */
export async function addOrganizationUser(organizationId: string, email: string, role: InternalRole, actorId: string, ip?: string, name?: string) {
  if (!INTERNAL_ROLES.includes(role)) throw errors.validation('Perfil inválido.');
  if (role === 'ADMIN') throw errors.validation('Não é possível criar outro ADMIN desta forma. Use LAWYER, ASSISTANT ou FINANCE.');
  const pool = getPool();
  const targetEmail = String(email ?? '').trim().toLowerCase();
  if (!targetEmail) throw errors.validation('Email é obrigatório.');

  let userId: string;
  let temporaryPassword: string | null = null;
  const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [targetEmail]);
  if (userRes.rows.length > 0) {
    userId = userRes.rows[0].id;
  } else {
    temporaryPassword = generateTemporaryPassword();
    const hash = hasher.hash(temporaryPassword);
    const newUser = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [String(name ?? targetEmail.split('@')[0] ?? 'Membro'), targetEmail, hash],
    );
    userId = newUser.rows[0].id;
  }

  const existing = await pool.query(
    'SELECT id FROM organization_members WHERE organization_id = $1 AND user_id = $2',
    [organizationId, userId],
  );
  if (existing.rows.length > 0) throw errors.conflict('Usuário já pertence à organização.');
  await pool.query('INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)', [organizationId, userId, role]);
  void auditLog({ organizationId, userId: actorId, action: 'ORGANIZATION_MEMBER_ADDED', entity: 'organization_member', entityId: userId, after: { email: targetEmail, role, created: temporaryPassword !== null }, ip });
  return { id: userId, email: targetEmail, role, temporaryPassword };
}

export async function updateMemberRole(organizationId: string, memberUserId: string, role: string, actorId: string, ip?: string) {
  if (!INTERNAL_ROLES.includes(role as InternalRole)) throw errors.validation('Perfil inválido.');
  const pool = getPool();
  const res = await pool.query(
    'UPDATE organization_members SET role = $1 WHERE organization_id = $2 AND user_id = $3 RETURNING role',
    [role, organizationId, memberUserId],
  );
  if (res.rows.length === 0) throw errors.notFound('Membro não encontrado.');
  void auditLog({ organizationId, userId: actorId, action: 'ORGANIZATION_MEMBER_ROLE_UPDATED', entity: 'organization_member', entityId: memberUserId, before: { role }, after: { role }, ip });
  return res.rows[0];
}

export async function removeOrganizationUser(organizationId: string, memberUserId: string, actorId: string, ip?: string) {
  const pool = getPool();
  if (memberUserId === actorId) throw errors.validation('Não é possível remover a si mesmo.');
  const res = await pool.query(
    'DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2 RETURNING user_id',
    [organizationId, memberUserId],
  );
  if (res.rows.length === 0) throw errors.notFound('Membro não encontrado.');
  void auditLog({ organizationId, userId: actorId, action: 'ORGANIZATION_MEMBER_REMOVED', entity: 'organization_member', entityId: memberUserId, after: { memberUserId }, ip });
  return { ok: true };
}
