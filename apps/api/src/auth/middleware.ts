import type { NextFunction, Request, Response } from 'express';
import { errors } from '../errors';
import { getSessionUser, touchSession } from './session';
import { getEnv } from '../config';
import { getPool } from '../db/client';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  organizationId: string | null;
  role: 'ADMIN' | 'LAWYER' | 'ASSISTANT' | null;
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
      'SELECT id, name, email FROM users WHERE id = $1',
      [session.userId],
    );
    if (userRes.rows.length === 0) {
      next(errors.unauthorized());
      return;
    }
    const user = userRes.rows[0];
    let role: AuthUser['role'] = null;
    if (session.organizationId) {
      const memberRes = await pool.query(
        'SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2',
        [session.organizationId, session.userId],
      );
      if (memberRes.rows.length > 0) role = memberRes.rows[0].role;
    }
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      organizationId: session.organizationId,
      role,
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

export function requireRole(...roles: AuthUser['role'][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.role || !roles.includes(req.user.role)) {
      next(errors.forbidden('Permissão insuficiente para esta ação.'));
      return;
    }
    next();
  };
}

export function getOrgId(req: Request): string {
  const orgId = req.user?.organizationId;
  if (!orgId) throw errors.forbidden('Nenhuma organização selecionada.');
  return orgId;
}
