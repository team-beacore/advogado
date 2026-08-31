const { Pool } = require('pg');
const { mkdirSync, existsSync, readdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const EmbeddedPostgres = require('embedded-postgres').default;

const DATA_DIR = join(__dirname, '..', 'data', 'pgdata');
const port = 54329;
const user = 'advogado';
const password = 'advogado';
const database = 'advogado';

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const pg = new EmbeddedPostgres({ databaseDir: DATA_DIR, user, password, port, persistent: true, onLog: () => {}, onError: () => {} });
  const pgVersionFile = join(DATA_DIR, 'PG_VERSION');
  if (!existsSync(pgVersionFile)) {
    if (existsSync(DATA_DIR) && readdirSync(DATA_DIR).length > 0) rmSync(DATA_DIR, { recursive: true, force: true });
    await pg.initialise();
  }
  await pg.start();
  const pool = new Pool({ connectionString: `postgres://${user}:${password}@127.0.0.1:${port}/${database}` });
  try {
    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name <> '_migrations' ORDER BY table_name",
    );
    const counts = [];
    for (const t of tables.rows) {
      const c = await pool.query(`SELECT count(*)::int AS n FROM "${t.table_name}"`);
      counts.push(`${t.table_name}=${c.rows[0].n}`);
    }
    console.log('Tabelas:', counts.join(', '));
    const total = counts.reduce((acc, s) => acc + Number(s.split('=')[1]), 0);
    console.log('Total de registros de negócio:', total);
    const mig = await pool.query('SELECT name FROM _migrations ORDER BY name');
    console.log('Migrations aplicadas:', mig.rows.map((m) => m.name).join(', '));
  } finally {
    await pool.end();
    await pg.stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});