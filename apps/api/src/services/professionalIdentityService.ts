import { getPool } from '../db/client';
import { errors } from '../errors';
import { auditLog } from '../audit/audit';

export interface ProfessionalIdentityInput {
  professionalName: string;
  oabNumber: string;
  oabState: string;
  identifiers?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export async function getIdentity(organizationId: string, userId: string) {
  const pool = getPool();
  const res = await pool.query(
    'SELECT * FROM professional_identities WHERE organization_id = $1 AND user_id = $2 LIMIT 1',
    [organizationId, userId],
  );
  return res.rows[0] ?? null;
}

export async function getIdentityById(organizationId: string, identityId: string) {
  const pool = getPool();
  const res = await pool.query(
    'SELECT * FROM professional_identities WHERE id = $1 AND organization_id = $2 LIMIT 1',
    [identityId, organizationId],
  );
  if (res.rows.length === 0) throw errors.notFound('Identidade profissional não encontrada.');
  return res.rows[0];
}

export async function listIdentities(organizationId: string) {
  const pool = getPool();
  const res = await pool.query(
    `SELECT pi.*, u.name AS user_name, u.email AS user_email
     FROM professional_identities pi
     JOIN users u ON u.id = pi.user_id
     WHERE pi.organization_id = $1
     ORDER BY pi.created_at DESC`,
    [organizationId],
  );
  return res.rows;
}

export async function upsertIdentity(organizationId: string, userId: string, input: ProfessionalIdentityInput) {
  const pool = getPool();
  const existing = await pool.query(
    'SELECT id FROM professional_identities WHERE organization_id = $1 AND user_id = $2',
    [organizationId, userId],
  );
  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE professional_identities SET professional_name = $1, oab_number = $2, oab_state = $3,
       identifiers = $4, metadata = $5, updated_at = now()
       WHERE id = $6`,
      [input.professionalName, input.oabNumber, input.oabState, input.identifiers ? JSON.stringify(input.identifiers) : null, input.metadata ? JSON.stringify(input.metadata) : null, existing.rows[0].id],
    );
    void auditLog({ organizationId, userId, action: 'PROFESSIONAL_IDENTITY_UPDATED', entity: 'professional_identity', entityId: existing.rows[0].id, after: { oabNumber: input.oabNumber, oabState: input.oabState }, metadata: { professionalName: input.professionalName } });
    return { id: existing.rows[0].id, created: false };
  }
  const res = await pool.query(
    `INSERT INTO professional_identities (organization_id, user_id, professional_name, oab_number, oab_state, identifiers, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [organizationId, userId, input.professionalName, input.oabNumber, input.oabState, input.identifiers ? JSON.stringify(input.identifiers) : null, input.metadata ? JSON.stringify(input.metadata) : null],
  );
  void auditLog({ organizationId, userId, action: 'PROFESSIONAL_IDENTITY_CREATED', entity: 'professional_identity', entityId: res.rows[0].id, after: { oabNumber: input.oabNumber, oabState: input.oabState }, metadata: { professionalName: input.professionalName } });
  return { id: res.rows[0].id, created: true };
}