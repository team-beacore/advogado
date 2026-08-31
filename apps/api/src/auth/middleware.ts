import type { NextFunction, Request, Response } from 'express';
import { errors } from '../errors';
import { getSessionUser, touchSession } from './session';
import { getEnv } from '../config';
import { getPool } from '../db/client';
import { ROLE_PERMISSIONS } from '@advogado/shared';
import type { Permission, Role } from '@advogado/shared';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  organizationId: string | null;
  organizationType: 'SOLO' | 'OFFICE' | null;
  role: Role | null;
  permissions: readonly Permission[];
  isSuperAdmin: boolean;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      ipAddress?: string;
    }
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const env = getEnv();
    const token = readCookie(req, env.COOKIE_NAME);
    const session = await getSessionUser(token ?? '');
    if (!session) {
      next(errors.unauthorized());
      return;
    }
    const pool = getPool();
    const userRes = await pool.query(
      'SELECT id, name, email, phone, is_super_admin FROM users WHERE id = $1',
      [session.userId],
    );
    if (userRes.rows.length === 0) {
      next(errors.unauthorized());
      return;
    }
    const user = userRes.rows[0];
    let role: Role | null = null;
    let organizationType: AuthUser['organizationType'] = null;
    if (user.is_super_admin) {
      role = 'SUPER_ADMIN';
    } else if (session.organizationId) {
      const memberRes = await pool.query(
        'SELECT om.role, o.plan_type FROM organization_members om JOIN organizations o ON o.id = om.organization_id WHERE om.organization_id = $1 AND om.user_id = $2',
        [session.organizationId, session.userId],
      );
      if (memberRes.rows.length > 0) {
        role = memberRes.rows[0].role as Role;
        const pt = memberRes.rows[0].plan_type;
        organizationType = pt === 'OFFICE' ? 'OFFICE' : pt === 'SOLO' ? 'SOLO' : null;
      }
    }
    const permissions = role ? ROLE_PERMISSIONS[role] : [];
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      organizationId: session.organizationId,
      organizationType,
      role,
      permissions,
      isSuperAdmin: Boolean(user.is_super_admin),
      sessionId: session.sessionId,
    };
    req.ipAddress = req.ip;
    void touchSession(session.sessionId);
    next();
  } catch (err) {
    next(err);
  }
}

export function requireOrg(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(errors.unauthorized());
    return;
  }
  if (!req.user.organizationId) {
    next(errors.forbidden('Nenhuma organização selecionada.'));
    return;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.role || !roles.includes(req.user.role)) {
      next(errors.forbidden('Permissão insuficiente para esta ação.'));
      return;
    }
    next();
  };
}

/** Exige uma permissão específica (camada ROLE + PERMISSION). */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(errors.unauthorized());
      return;
    }
    const userPerms = req.user.permissions;
    const has = permissions.some((p) => userPerms.includes(p));
    if (!has) {
      next(errors.forbidden('Permissão insuficiente para esta ação.'));
      return;
    }
    next();
  };
}

/** Exige um plano da organização (camada PLAN). Ex.: requirePlan('OFFICE').
 *  Organizações sem plano definido (legadas) são tratadas como OFFICE para retrocompatibilidade.
 *  Apenas o plano explicitamente 'SOLO' bloqueia recursos de equipe. */
export function requirePlan(...plans: Array<'SOLO' | 'OFFICE'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(errors.unauthorized());
      return;
    }
    const type = req.user.organizationType ?? 'OFFICE';
    if (!plans.includes(type)) {
      next(errors.forbidden('Gerenciamento de equipe não está disponível para este plano.'));
      return;
    }
    next();
  };
}

/** Restrito ao SUPER ADMIN (operador/implantador da plataforma). */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user?.isSuperAdmin) {
    next(errors.forbidden('Acesso restrito ao administrador da plataforma.'));
    return;
  }
  next();
}

export function getOrgId(req: Request): string {
  const orgId = req.user?.organizationId;
  if (!orgId) throw errors.forbidden('Nenhuma organização selecionada.');
  return orgId;
}