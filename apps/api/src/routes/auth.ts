import { Router } from 'express';
import { registerSchema, loginSchema, updateUserProfileSchema, changePasswordSchema } from '@advogado/shared';
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
      'INSERT INTO users (name, email, password_hash, phone) VALUES ($1, $2, $3, $4) RETURNING id, name, email, phone, is_super_admin, created_at',
      [data.name, data.email, passwordHash, data.phone ?? null],
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
    const userRes = await pool.query('SELECT id, name, email, phone, is_super_admin, password_hash FROM users WHERE email = $1', [data.email]);
    if (userRes.rows.length === 0) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: 'Email ou senha inválidos.' });
      return;
    }
    const user = userRes.rows[0];
    if (!hasher.verify(data.password, user.password_hash)) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: 'Email ou senha inválidos.' });
      return;
    }
    // Auto-select first org as active organization (exceto SUPER ADMIN da plataforma)
    let orgId: string | null = null;
    if (!user.is_super_admin) {
      const orgRes = await pool.query('SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1', [user.id]);
      orgId = orgRes.rows[0]?.organization_id ?? null;
    }
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
    res.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone ?? null, isSuperAdmin: Boolean(user.is_super_admin) }, organizationId: orgId, expiresAt: session.expiresAt });
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

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const data = updateUserProfileSchema.parse(req.body);
    const pool = getPool();
    const res2 = await pool.query(
      `UPDATE users SET name = COALESCE($2, name), phone = $3, updated_at = now()
       WHERE id = $1 RETURNING id, name, email, phone, created_at`,
      [req.user!.id, data.name ?? null, data.phone ?? null],
    );
    const user = res2.rows[0];
    void auditLog({ organizationId: req.user!.organizationId, userId: req.user!.id, action: 'USER_PROFILE_UPDATED', entity: 'user', entityId: user.id, after: { name: user.name, phone: Boolean(user.phone) }, ip: req.ip });
    res.json({ user });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

/**
 * Alteração de senha pelo próprio usuário autenticado.
 * Valida a senha atual, persiste apenas o hash da nova senha,
 * invalida as demais sessões do usuário e registra auditoria.
 * A senha nunca é registrada em logs.
 */
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const data = changePasswordSchema.parse(req.body);
    const pool = getPool();
    const userRes = await pool.query('SELECT id, password_hash FROM users WHERE id = $1', [req.user!.id]);
    const user = userRes.rows[0];
    if (!user) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Usuário não encontrado.' });
      return;
    }
    if (!hasher.verify(data.currentPassword, user.password_hash)) {
      res.status(400).json({ code: 'INVALID_PASSWORD', message: 'Senha atual incorreta.' });
      return;
    }
    const newHash = hasher.hash(data.newPassword);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [newHash, req.user!.id]);
    // Invalida as demais sessões do usuário (mantém a atual)
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [req.user!.id, req.user!.sessionId]);
    void auditLog({ organizationId: req.user!.organizationId, userId: req.user!.id, action: 'USER_PASSWORD_CHANGED', entity: 'user', entityId: req.user!.id, after: { changed: true }, ip: req.ip });
    res.json({ ok: true });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

export default router;