import { errors } from '../errors';
import { getPool } from '../db/client';
import { auditLog } from '../audit/audit';
import { addEvent } from '../events/timeline';

export interface CaseInput {
  clientId?: string | null;
  title: string;
  processNumber?: string | null;
  court?: string | null;
  jurisdiction?: string | null;
  area?: string | null;
  description?: string | null;
  status?: string;
  responsibleId?: string | null;
}

export async function createCase(organizationId: string, input: CaseInput, userId: string, ip?: string) {
  const pool = getPool();
  if (input.clientId) {
    const clientRes = await pool.query('SELECT id FROM clients WHERE id = $1 AND organization_id = $2', [input.clientId, organizationId]);
    if (clientRes.rows.length === 0) throw errors.validation('Cliente inválido para esta organização.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `INSERT INTO cases (organization_id, client_id, title, process_number, court, jurisdiction, area, description, status, responsible_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        organizationId,
        input.clientId ?? null,
        input.title,
        input.processNumber ?? null,
        input.court ?? null,
        input.jurisdiction ?? null,
        input.area ?? null,
        input.description ?? null,
        input.status ?? 'ACTIVE',
        input.responsibleId ?? userId,
      ],
    );
    const caseRow = res.rows[0];
    // Criador entra automaticamente como membro com permissão de gerenciar
    await client.query(
      `INSERT INTO case_members (case_id, user_id, role, can_view, can_edit, can_manage)
       VALUES ($1, $2, 'ADMIN', TRUE, TRUE, TRUE) ON CONFLICT (case_id, user_id) DO NOTHING`,
      [caseRow.id, userId],
    );
    await client.query('COMMIT');
    await addEvent({
      processId: caseRow.id,
      type: 'PROCESS_CREATED',
      title: 'Processo criado',
      description: `Processo "${caseRow.title}" criado na plataforma.`,
      createdBy: userId,
    });
    void auditLog({ organizationId, userId, action: 'CASE_CREATED', entity: 'case', entityId: caseRow.id, after: { title: caseRow.title, status: caseRow.status }, ip });
    return caseRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateCase(organizationId: string, caseId: string, input: Partial<CaseInput>, userId: string, ip?: string) {
  const pool = getPool();
  const before = await pool.query('SELECT * FROM cases WHERE id = $1 AND organization_id = $2', [caseId, organizationId]);
  if (before.rows.length === 0) throw errors.notFound('Processo não encontrado.');
  const old = before.rows[0];
  const res = await pool.query(
    `UPDATE cases SET
       client_id = COALESCE($2, client_id),
       title = COALESCE($3, title),
       process_number = $4,
       court = COALESCE($5, court),
       jurisdiction = COALESCE($6, jurisdiction),
       area = COALESCE($7, area),
       description = $8,
       status = COALESCE($9, status),
       responsible_id = $10,
       updated_at = now()
     WHERE id = $1 AND organization_id = $11 RETURNING *`,
    [
      caseId,
      input.clientId ?? null,
      input.title,
      input.processNumber ?? null,
      input.court ?? null,
      input.jurisdiction ?? null,
      input.area ?? null,
      input.description ?? null,
      input.status,
      input.responsibleId ?? null,
      organizationId,
    ],
  );
  const updated = res.rows[0];
  if (old.status !== updated.status) {
    await addEvent({
      processId: caseId,
      type: 'STATUS_CHANGED',
      title: `Status alterado para ${updated.status}`,
      description: `Status alterado de ${old.status} para ${updated.status}.`,
      createdBy: userId,
    });
  }
  void auditLog({ organizationId, userId, action: 'CASE_UPDATED', entity: 'case', entityId: caseId, before: old, after: updated, ip });
  return updated;
}

export async function getCase(organizationId: string, caseId: string) {
  const pool = getPool();
  const res = await pool.query(
    `SELECT c.*, u.name AS responsible_name, cl.name AS client_name
     FROM cases c
     LEFT JOIN users u ON u.id = c.responsible_id
     LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE c.id = $1 AND c.organization_id = $2`,
    [caseId, organizationId],
  );
  if (res.rows.length === 0) throw errors.notFound('Processo não encontrado.');
  return res.rows[0];
}

export type CasePermission = 'view' | 'edit' | 'manage';

export interface CaseAccess {
  level: CasePermission | 'none';
  memberId: string | null;
  role: string | null;
}

/**
 * Resolve o nível de acesso granular de um usuário a um processo.
 * - ADMIN da organização tem acesso total (manage).
 * - Responsável pelo processo tem edit (não gerencia membros por padrão).
 * - Membros do processo (case_members) seguem as permissões can_view/can_edit/can_manage.
 */
export async function getCaseAccess(organizationId: string, caseId: string, userId: string, orgRole?: string | null): Promise<CaseAccess> {
  const pool = getPool();
  const caseRes = await pool.query(
    `SELECT c.id, c.responsible_id FROM cases c WHERE c.id = $1 AND c.organization_id = $2`,
    [caseId, organizationId],
  );
  if (caseRes.rows.length === 0) throw errors.notFound('Processo não encontrado.');

  if (orgRole === 'ADMIN') {
    return { level: 'manage', memberId: null, role: 'ADMIN' };
  }

  const memberRes = await pool.query(
    `SELECT id, role, can_view, can_edit, can_manage FROM case_members WHERE case_id = $1 AND user_id = $2`,
    [caseId, userId],
  );
  const member = memberRes.rows[0];
  if (member) {
    const level: CasePermission | 'none' = member.can_manage
      ? 'manage'
      : member.can_edit
        ? 'edit'
        : member.can_view
          ? 'view'
          : 'none';
    return { level, memberId: member.id, role: member.role };
  }

  if (caseRes.rows[0].responsible_id === userId) {
    return { level: 'edit', memberId: null, role: 'LAWYER' };
  }

  return { level: 'none', memberId: null, role: null };
}

/**
 * Garante que o usuário tenha o nível de permissão exigido no processo.
 * Lança 404 se o processo não existir e 403 se não tiver permissão.
 */
export async function assertCasePermission(organizationId: string, caseId: string, userId: string, required: CasePermission, orgRole?: string | null): Promise<CaseAccess> {
  const access = await getCaseAccess(organizationId, caseId, userId, orgRole);
  if (access.level === 'none') {
    throw errors.forbidden('Permissão insuficiente para este processo.');
  }
  const order: CasePermission[] = ['view', 'edit', 'manage'];
  if (order.indexOf(access.level) < order.indexOf(required)) {
    throw errors.forbidden('Permissão insuficiente para este processo.');
  }
  return access;
}

export async function assertCaseAccess(organizationId: string, caseId: string): Promise<void> {
  await getCase(organizationId, caseId);
}

export async function listCases(
  organizationId: string,
  opts: { search?: string; status?: string; clientId?: string; area?: string; sort?: string; page?: number; pageSize?: number },
) {
  const pool = getPool();
  const params: unknown[] = [organizationId];
  let where = 'c.organization_id = $1';
  if (opts.status) {
    params.push(opts.status);
    where += ` AND c.status = $${params.length}`;
  }
  if (opts.clientId) {
    params.push(opts.clientId);
    where += ` AND c.client_id = $${params.length}`;
  }
  if (opts.area) {
    params.push(`%${opts.area}%`);
    where += ` AND c.area ILIKE $${params.length}`;
  }
  if (opts.search) {
    params.push(`%${opts.search}%`);
    where += ` AND (c.title ILIKE $${params.length} OR COALESCE(c.process_number,'') ILIKE $${params.length})`;
  }
  const sortMap: Record<string, string> = {
    created_desc: 'c.created_at DESC',
    created_asc: 'c.created_at ASC',
    title_asc: 'c.title ASC',
  };
  const order = sortMap[opts.sort ?? 'created_desc'] ?? 'c.created_at DESC';
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  params.push(pageSize, (page - 1) * pageSize);
  const res = await pool.query(
    `SELECT c.*, u.name AS responsible_name, cl.name AS client_name,
       (SELECT count(*)::int FROM documents d WHERE d.process_id = c.id AND d.deleted_at IS NULL) AS document_count,
       (SELECT count(*)::int FROM legal_publications p WHERE p.process_id = c.id AND p.status = 'PENDING') AS pending_publication_count,
       (SELECT count(*)::int FROM tasks t WHERE t.process_id = c.id AND t.status IN ('TODO','IN_PROGRESS')) AS open_task_count
     FROM cases c
     LEFT JOIN users u ON u.id = c.responsible_id
     LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE ${where}
     ORDER BY ${order}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const countRes = await pool.query(`SELECT count(*)::int AS total FROM cases c WHERE ${where}`, params.slice(0, params.length - 2));
  return { items: res.rows, total: countRes.rows[0]?.total ?? 0, page, pageSize };
}

export async function getCaseDetail(organizationId: string, caseId: string) {
  const pool = getPool();
  const caseRow = await getCase(organizationId, caseId);
  const [members, events, documents, publications, tasks] = await Promise.all([
    pool.query(
      `SELECT cm.id, cm.role, u.id AS user_id, u.name, u.email FROM case_members cm JOIN users u ON u.id = cm.user_id WHERE cm.case_id = $1`,
      [caseId],
    ),
    pool.query(
      `SELECT e.*, u.name AS created_by_name FROM case_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.process_id = $1 ORDER BY e.created_at DESC LIMIT 300`,
      [caseId],
    ),
    pool.query(
      `SELECT d.id, d.name, d.file_name, d.mime_type, d.size, d.hash, d.created_at, d.extraction_status, d.extraction_method, d.extracted_at, u.name AS uploaded_by_name
       FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.process_id = $1 AND d.deleted_at IS NULL ORDER BY d.created_at DESC`,
      [caseId],
    ),
    pool.query(
      `SELECT * FROM legal_publications WHERE process_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [caseId],
    ),
    pool.query(
      `SELECT t.*, u.name AS assigned_name FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.process_id = $1 ORDER BY t.created_at DESC LIMIT 200`,
      [caseId],
    ),
  ]);
  return {
    ...caseRow,
    members: members.rows,
    events: events.rows,
    documents: documents.rows,
    publications: publications.rows,
    tasks: tasks.rows,
  };
}

export async function addCaseMember(organizationId: string, caseId: string, userId: string, role: string, actorId: string, ip?: string) {
  const pool = getPool();
  await assertCaseAccess(organizationId, caseId);
  const memberOk = await pool.query(
    'SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2',
    [organizationId, userId],
  );
  if (memberOk.rows.length === 0) throw errors.validation('Usuário não pertence à organização.');
  const canView = true;
  const canEdit = role !== 'ASSISTANT';
  const canManage = role === 'ADMIN';
  const res = await pool.query(
    `INSERT INTO case_members (case_id, user_id, role, can_view, can_edit, can_manage)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (case_id, user_id) DO UPDATE SET role = EXCLUDED.role, can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit, can_manage = EXCLUDED.can_manage, updated_at = now()
     RETURNING *`,
    [caseId, userId, role, canView, canEdit, canManage],
  );
  await addEvent({ processId: caseId, type: 'CASE_MEMBER_ADDED', title: 'Membro adicionado ao processo', description: `Usuário com papel ${role} associado.`, createdBy: actorId });
  void auditLog({ organizationId, userId: actorId, action: 'CASE_MEMBER_ADDED', entity: 'case_member', entityId: res.rows[0].id, after: { userId, role, canView, canEdit, canManage, caseId }, ip });
  return res.rows[0];
}

export async function updateCaseMemberPermissions(
  organizationId: string,
  caseId: string,
  memberUserId: string,
  input: { canView?: boolean; canEdit?: boolean; canManage?: boolean; role?: string },
  actorId: string,
  ip?: string,
) {
  const pool = getPool();
  await assertCaseAccess(organizationId, caseId);
  const before = await pool.query(
    'SELECT * FROM case_members WHERE case_id = $1 AND user_id = $2',
    [caseId, memberUserId],
  );
  if (before.rows.length === 0) throw errors.notFound('Membro não está associado a este processo.');
  const old = before.rows[0];
  const res = await pool.query(
    `UPDATE case_members SET
       can_view = COALESCE($3, can_view),
       can_edit = COALESCE($4, can_edit),
       can_manage = COALESCE($5, can_manage),
       role = COALESCE($6, role),
       updated_at = now()
     WHERE case_id = $1 AND user_id = $2 RETURNING *`,
    [caseId, memberUserId, input.canView ?? null, input.canEdit ?? null, input.canManage ?? null, input.role ?? null],
  );
  const updated = res.rows[0];
  await addEvent({ processId: caseId, type: 'CASE_MEMBER_UPDATED', title: 'Permissões de membro atualizadas', description: `Permissões do membro no processo foram atualizadas.`, createdBy: actorId });
  void auditLog({ organizationId, userId: actorId, action: 'CASE_MEMBER_PERMISSIONS_UPDATED', entity: 'case_member', entityId: updated.id, before: old, after: updated, ip });
  return updated;
}

export async function removeCaseMember(organizationId: string, caseId: string, memberUserId: string, actorId: string, ip?: string) {
  const pool = getPool();
  await assertCaseAccess(organizationId, caseId);
  const res = await pool.query('DELETE FROM case_members WHERE case_id = $1 AND user_id = $2 RETURNING id', [caseId, memberUserId]);
  if (res.rows.length === 0) throw errors.notFound('Membro não está associado a este processo.');
  await addEvent({ processId: caseId, type: 'CASE_MEMBER_REMOVED', title: 'Membro removido do processo', description: `Usuário removido do processo.`, createdBy: actorId });
  void auditLog({ organizationId, userId: actorId, action: 'CASE_MEMBER_REMOVED', entity: 'case_member', entityId: res.rows[0].id, after: { userId: memberUserId, caseId }, ip });
  return { ok: true };
}
