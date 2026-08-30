import { randomBytes } from 'node:crypto';
import { getPool } from '../db/client';
import { sha256Hex } from './password';
import { getEnv } from '../config';

const TOKEN_BYTES = 32;

export async function createSession(userId: string, organizationId: string | null, ip?: string, userAgent?: string): Promise<{ token: string; expiresAt: Date }> {
  const env = getEnv();
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const pool = getPool();
  await pool.query(
    'INSERT INTO sessions (user_id, token_hash, organization_id, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6)',
    [userId, tokenHash, organizationId, expiresAt.toISOString(), ip ?? null, userAgent ?? null],
  );
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  const tokenHash = sha256Hex(token);
  const pool = getPool();
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

export interface SessionUser {
  sessionId: string;
  userId: string;
  organizationId: string | null;
  expiresAt: Date;
}

export async function getSessionUser(token: string): Promise<SessionUser | null> {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const pool = getPool();
  const res = await pool.query(
    'SELECT id, user_id, organization_id, expires_at FROM sessions WHERE token_hash = $1',
    [tokenHash],
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  const expiresAt = new Date(row.expires_at);
  if (expiresAt < new Date()) {
    await pool.query('DELETE FROM sessions WHERE id = $1', [row.id]);
    return null;
  }
  return {
    sessionId: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    expiresAt,
  };
}

export async function touchSession(sessionId: string): Promise<void> {
  const pool = getPool();
  await pool.query('UPDATE sessions SET last_active_at = now() WHERE id = $1', [sessionId]);
}

export async function cleanupExpiredSessions(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
}
