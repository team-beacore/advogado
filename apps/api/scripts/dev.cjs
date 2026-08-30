const { spawn } = require('node:child_process');
const { mkdirSync, existsSync, readdirSync, rmSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const EmbeddedPostgres = require('embedded-postgres').default;

const DATA_DIR = join(__dirname, '..', 'data', 'pgdata');
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const port = 54329;
const user = 'advogado';
const password = 'advogado';
const database = 'advogado';

async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const exists = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
      if (exists.rowCount && exists.rowCount > 0) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log('  applied:', file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

async function startDb() {
  mkdirSync(DATA_DIR, { recursive: true });
  const pg = new EmbeddedPostgres({ databaseDir: DATA_DIR, user, password, port, persistent: true, onLog: () => {}, onError: () => {} });
  const pgVersionFile = join(DATA_DIR, 'PG_VERSION');
  if (!existsSync(pgVersionFile)) {
    if (existsSync(DATA_DIR) && readdirSync(DATA_DIR).length > 0) rmSync(DATA_DIR, { recursive: true, force: true });
    await pg.initialise();
  }
  await pg.start();
  const { Pool } = require('pg');
  const admin = new Pool({ host: '127.0.0.1', port, database: 'postgres', user, password, connectionTimeoutMillis: 10000 });
  const res = await admin.query("SELECT datname FROM pg_database WHERE datistemplate = false AND datname = $1", [database]);
  if (res.rows.length === 0) {
    await admin.query(`CREATE DATABASE "${database}"`);
    console.log('Database created:', database);
  }
  await admin.end();
  console.log(`PostgreSQL running on 127.0.0.1:${port} (DB: ${database})`);
  // Run migrations
  const pool = new (require('pg').Pool)({ connectionString: `postgres://${user}:${password}@127.0.0.1:${port}/${database}` });
  try {
    await runMigrations(pool);
    console.log('Migrations up to date.');
  } finally {
    await pool.end();
  }
  return pg;
}

async function main() {
  console.log('Starting database...');
  const pg = await startDb();
  console.log('Starting API server...');
  const api = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'watch', 'src/index.ts'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: `postgres://${user}:${password}@127.0.0.1:${port}/${database}` },
    shell: true,
  });
  api.on('exit', async (code) => {
    await pg.stop();
    process.exit(code ?? 0);
  });
  process.on('SIGINT', async () => {
    api.kill('SIGINT');
    await pg.stop();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});