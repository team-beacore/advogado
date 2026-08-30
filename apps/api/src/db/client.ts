import { Pool } from 'pg';
import { getEnv } from '../config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const env = getEnv();
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 20 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function connectionOk(): Promise<boolean> {
  const p = getPool();
  try {
    await p.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}