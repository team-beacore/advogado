const { spawn } = require('node:child_process');
const { mkdirSync, existsSync, readdirSync, rmSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const EmbeddedPostgres = require('embedded-postgres').default;

const DATA_DIR = join(__dirname, '..', 'data', 'pgdata');
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const port = 54329;
const user = 'advogado';
const password = 'advogado';
const database = 'advogado_test';

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
  return pg;
}

async function killExisting() {
  try {
    if (process.platform === 'win32') {
      require('child_process').execSync('taskkill /F /IM postgres.exe /T 2>nul', { stdio: 'ignore' });
    } else {
      require('child_process').execSync('pkill -9 postgres 2>/dev/null', { stdio: 'ignore' });
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 2000));
}

async function main() {
  const testFiles = process.argv.slice(2);
  console.log('[test] Cleaning up any leftover PostgreSQL...');
  await killExisting();
  console.log('[test] Starting database...');
  const pg = await startDb();
  const { Pool } = require('pg');
  const admin = new Pool({ host: '127.0.0.1', port, database: 'postgres', user, password, connectionTimeoutMillis: 10000 });
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${database}"`);
  await admin.end();
  const pool = new Pool({ connectionString: `postgres://${user}:${password}@127.0.0.1:${port}/${database}` });
  await runMigrations(pool);
  await pool.end();
  console.log('[test] Database ready. Running targeted tests...');

  const env = { ...process.env, DATABASE_URL: `postgres://${user}:${password}@127.0.0.1:${port}/${database}`, NODE_ENV: 'test', OPENAI_API_KEY: '', AI_PROVIDER: 'openai', PROCESS_MONITOR_ENABLED: 'false' };
  const args = ['tsx', '--test', '--test-concurrency=1', ...testFiles];
  const testProc = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { cwd: join(__dirname, '..'), stdio: 'inherit', env, shell: true });
  testProc.on('exit', async (code) => {
    await pg.stop();
    process.exit(code ?? 0);
  });
  process.on('SIGINT', async () => {
    testProc.kill('SIGINT');
    await pg.stop();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('FATAL:', e && e.message ? e.message : e);
  process.exit(1);
});
