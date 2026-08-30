import { Router } from 'express';
import { registerSchema, loginSchema } from '@advogado/shared';
import { getPool } from '../db/client';
import { ScryptHasher } from '../auth/password';
import { createSession, destroySession } from '../auth/session';
import { requireAuth } from '../auth/middleware';
import { auditLog } from '../audit/audit';
import { loadEnv } from '../config';

const router = Router();
const hasher = new ScryptHasher();

router.post('/register', async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const pool = getPool();
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [data.email]);
    if (existing.rows.length > 0) {
      res.status(409).json({ code: 'CONFLICT', message: 'Email já cadastrado.' });
      return;
    }
    const passwordHash = hasher.hash(data.password);
    const userRes = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
      [data.name, data.email, passwordHash],
    );
    const user = userRes.rows[0];
    void auditLog({ organizationId: null, userId: user.id, action: 'USER_REGISTERED', entity: 'user', entityId: user.id, after: { email: user.email }, ip: req.ip });
    res.status(201).json({ user });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const pool = getPool();
    const userRes = await pool.query('SELECT id, name, email, password_hash FROM users WHERE email = $1', [data.email]);
    if (userRes.rows.length === 0) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: 'Email ou senha inválidos.' });
      return;
    }
    const user = userRes.rows[0];
    if (!hasher.verify(data.password, user.password_hash)) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: 'Email ou senha inválidos.' });
      return;
    }
    // Auto-select first org as active organization
    const orgRes = await pool.query('SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1', [user.id]);
    const orgId = orgRes.rows[0]?.organization_id ?? null;
    const session = await createSession(user.id, orgId, req.ip, req.headers['user-agent']);
    const env = loadEnv();
    const maxAge = env.SESSION_TTL_DAYS * 24 * 60 * 60;
    res.cookie(env.COOKIE_NAME, session.token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: maxAge * 1000,
      path: '/',
    });
    void auditLog({ organizationId: orgId, userId: user.id, action: 'USER_LOGIN', entity: 'user', entityId: user.id, ip: req.ip });
    res.json({ user: { id: user.id, name: user.name, email: user.email }, organizationId: orgId, expiresAt: session.expiresAt });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const env = loadEnv();
    const token = req.headers.cookie
      ?.split(';')
      .find((c) => c.trim().startsWith(env.COOKIE_NAME + '='))
      ?.split('=')[1]
      ?.trim();
    if (token) await destroySession(token);
    res.clearCookie(env.COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;