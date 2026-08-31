import { Router } from 'express';
import { clientPortalLoginSchema } from '@advogado/shared';
import { errors } from '../errors';
import {
  clientCookieName,
  loginClientPortal,
  createClientSession,
  getClientSessionUser,
  destroyClientSession,
  getPortalProfile,
  listSharedCases,
  getSharedCase,
  listSharedCaseDocuments,
} from '../services/portalService';

const router = Router();

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

router.post('/login', async (req, res, next) => {
  try {
    const data = clientPortalLoginSchema.parse(req.body);
    const portal = await loginClientPortal(data.email, data.password);
    const token = await createClientSession(portal.id, portal.organization_id);
    res.cookie(clientCookieName(), token, { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000, path: '/' });
    res.json({ ok: true });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    const status = (err as { status?: number }).status;
    if (status) { res.status(status).json({ code: (err as { code?: string }).code ?? 'ERROR', message: (err as Error).message }); return; }
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = readCookie(req.headers.cookie, clientCookieName());
    if (token) await destroyClientSession(token);
    res.clearCookie(clientCookieName(), { path: '/' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/me', async (req, res, next) => {
  try {
    const token = readCookie(req.headers.cookie, clientCookieName());
    const session = token ? await getClientSessionUser(token) : null;
    if (!session) throw errors.unauthorized('Sessão do portal inválida.');
    const profile = await getPortalProfile(session.portalUserId, session.organizationId);
    res.json({ client: profile });
  } catch (err) { next(err); }
});

router.get('/processes', async (req, res, next) => {
  try {
    const token = readCookie(req.headers.cookie, clientCookieName());
    const session = token ? await getClientSessionUser(token) : null;
    if (!session) throw errors.unauthorized('Sessão do portal inválida.');
    const items = await listSharedCases(session.portalUserId, session.organizationId);
    res.json({ items });
  } catch (err) { next(err); }
});

router.get('/processes/:id', async (req, res, next) => {
  try {
    const token = readCookie(req.headers.cookie, clientCookieName());
    const session = token ? await getClientSessionUser(token) : null;
    if (!session) throw errors.unauthorized('Sessão do portal inválida.');
    const process = await getSharedCase(session.portalUserId, session.organizationId, req.params.id!);
    if (!process) throw errors.notFound('Processo não compartilhado com este cliente.');
    res.json({ process });
  } catch (err) { next(err); }
});

router.get('/processes/:id/documents', async (req, res, next) => {
  try {
    const token = readCookie(req.headers.cookie, clientCookieName());
    const session = token ? await getClientSessionUser(token) : null;
    if (!session) throw errors.unauthorized('Sessão do portal inválida.');
    const items = await listSharedCaseDocuments(session.portalUserId, session.organizationId, req.params.id!);
    res.json({ items });
  } catch (err) { next(err); }
});

export default router;