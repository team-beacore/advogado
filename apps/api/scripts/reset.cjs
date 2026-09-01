const { spawn } = require('node:child_process');
const { mkdirSync, existsSync, readdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const EmbeddedPostgres = require('embedded-postgres').default;

const DATA_DIR = join(__dirname, '..', 'data', 'pgdata');
const STORAGE_DIR = join(__dirname, '..', 'data', 'storage');
const port = 54329;
const user = 'advogado';
const password = 'advogado';
const database = 'advogado';

const TABLES = [
  'audit_logs',
  'ai_approvals',
  'ai_interactions',
  'capture_runs',
  'payments',
  'installments',
  'invoices',
  'contracts',
  'notification_deliveries',
  'notifications',
  'notification_preferences',
  'client_notification_preferences',
  'case_events',
  'case_members',
  'documents',
  'legal_publications',
  'tasks',
  'leads',
  'clients',
  'cases',
  'organization_members',
  'organizations',
  'sessions',
  'users',
];

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const pg = new EmbeddedPostgres({ databaseDir: DATA_DIR, user, password, port, persistent: true, onLog: () => {}, onError: () => {} });
  const pgVersionFile = join(DATA_DIR, 'PG_VERSION');
  if (!existsSync(pgVersionFile)) {
    if (existsSync(DATA_DIR) && readdirSync(DATA_DIR).length > 0) rmSync(DATA_DIR, { recursive: true, force: true });
    await pg.initialise();
  }
  await pg.start();
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: `postgres://${user}:${password}@127.0.0.1:${port}/${database}` });

  try {
    const existing = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> '_migrations'`,
    );
    const existingNames = new Set(existing.rows.map((r) => r.table_name));
    const toTruncate = TABLES.filter((t) => existingNames.has(t));
    if (toTruncate.length === 0) {
      console.log('Nenhuma tabela de dados de negócio encontrada.');
    } else {
      await pool.query(`TRUNCATE TABLE ${toTruncate.join(', ')} RESTART IDENTITY CASCADE`);
      console.log('Dados de negócio apagados:', toTruncate.join(', '));
    }
    console.log('Schema, migrations, enums e índices preservados.');
  } finally {
    await pool.end();
    await pg.stop();
  }

  // Limpar arquivos físicos do storage local (apenas dados, mantém a estrutura)
  if (existsSync(STORAGE_DIR)) {
    const entries = rmSync(STORAGE_DIR, { recursive: true, force: true });
    void entries;
    mkdirSync(STORAGE_DIR, { recursive: true });
    console.log('Arquivos do storage local limpos.');
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e ?? 'erro desconhecido');
  console.error('FATAL:', msg);
  process.exit(1);
});
