import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';

let started = false;
let pgInstance: EmbeddedPostgres | null = null;

const DATA_DIR = join(process.cwd(), 'data', 'pgdata');
const DEFAULT_PORT = 54329;
const DEFAULT_USER = 'advogado';
const DEFAULT_PASSWORD = 'advogado';
const DEFAULT_DATABASE = 'advogado';

const port = Number(process.env.PG_PORT ?? DEFAULT_PORT);
const user = process.env.PG_USER ?? DEFAULT_USER;
const password = process.env.PG_PASSWORD ?? DEFAULT_PASSWORD;
const database = process.env.PG_DATABASE ?? DEFAULT_DATABASE;

function createPg(): EmbeddedPostgres {
  mkdirSync(DATA_DIR, { recursive: true });
  return new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user,
    password,
    port,
    persistent: true,
    onLog: () => {},
    onError: () => {},
  });
}

export async function ensureDatabaseStarted(): Promise<boolean> {
  if (started && pgInstance) return true;
  if (pgInstance && !started) {
    return false;
  }
  try {
    pgInstance = createPg();
    const pgVersionFile = join(DATA_DIR, 'PG_VERSION');
    if (!existsSync(pgVersionFile)) {
      if (existsSync(DATA_DIR) && readdirSync(DATA_DIR).length > 0) {
        rmSync(DATA_DIR, { recursive: true, force: true });
      }
      await pgInstance.initialise();
    }
    await pgInstance.start();
    // Use the default "postgres" database to manage databases
    const admin = new Pool({ user, password, host: '127.0.0.1', port, database: 'postgres', connectionTimeoutMillis: 10000 });
    const res = await admin.query("SELECT datname FROM pg_database WHERE datistemplate = false AND datname = $1", [database]);
    if (res.rows.length === 0) {
      await admin.query(`CREATE DATABASE "${database}"`);
    }
    await admin.end();
    started = true;
    console.log(`PostgreSQL embarcado rodando em 127.0.0.1:${port} (banco: "${database}")`);
    return true;
  } catch (err) {
    console.error('Falha ao iniciar PostgreSQL embarcado:', err);
    pgInstance = null;
    return false;
  }
}

export async function stopEmbedded(): Promise<void> {
  if (pgInstance) {
    try {
      await pgInstance.stop();
    } catch {
      /* ignore */
    }
    pgInstance = null;
    started = false;
  }
}