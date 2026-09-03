const { mkdirSync, existsSync, readdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const EmbeddedPostgres = require('embedded-postgres').default;

const DATA_DIR = join(__dirname, '..', 'data', 'pgdata');
const STORAGE_DIR = join(__dirname, '..', 'data', 'storage');

const port = 54329;
const user = 'advogado';
const password = 'advogado';
const database = 'advogado';

function log(message) {
  console.log(`[RESET] ${new Date().toISOString()} ${message}`);
}

async function main() {
  log('INÍCIO');

  log(`DATA_DIR: ${DATA_DIR}`);

  mkdirSync(DATA_DIR, { recursive: true });
  log('DATA_DIR garantido');

  log('Criando instância EmbeddedPostgres...');

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user,
    password,
    port,
    persistent: true,
    onLog: (message) => console.log('[PG LOG]', message),
    onError: (message) => console.error('[PG ERROR]', message),
  });

  log('Instância EmbeddedPostgres criada');

  const pgVersionFile = join(DATA_DIR, 'PG_VERSION');

  log(`PG_VERSION existe? ${existsSync(pgVersionFile)}`);

  if (!existsSync(pgVersionFile)) {
    log('PG_VERSION não existe');

    const entries = existsSync(DATA_DIR)
      ? readdirSync(DATA_DIR)
      : [];

    log(`Arquivos encontrados no DATA_DIR: ${entries.length}`);

    if (entries.length > 0) {
      log('Limpando DATA_DIR...');
      rmSync(DATA_DIR, { recursive: true, force: true });
      log('DATA_DIR limpo');

      mkdirSync(DATA_DIR, { recursive: true });
      log('DATA_DIR recriado');
    }

    log('INICIANDO pg.initialise()...');
    await pg.initialise();
    log('pg.initialise() TERMINOU');
  }

  log('INICIANDO pg.start()...');
  await pg.start();
  log('pg.start() TERMINOU');

  log('Carregando pg...');
  const { Pool } = require('pg');

  const connectionString =
    `postgres://${user}:${password}@127.0.0.1:${port}/${database}`;

  log(`Conectando ao PostgreSQL em 127.0.0.1:${port}...`);

  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 10000,
  });

  try {
    log('Executando SELECT de teste...');

    const result = await pool.query('SELECT NOW() AS now');

    log(`PostgreSQL respondeu: ${result.rows[0].now}`);

    log('RESET diagnosticamente chegou ao banco com sucesso');
  } finally {
    log('Fechando pool...');
    await pool.end();
    log('Pool fechado');

    log('Parando PostgreSQL...');
    await pg.stop();
    log('PostgreSQL parado');
  }

  log('Limpando storage...');

  if (existsSync(STORAGE_DIR)) {
    rmSync(STORAGE_DIR, { recursive: true, force: true });
  }

  mkdirSync(STORAGE_DIR, { recursive: true });

  log('Storage limpo');
  log('FIM');
}

main().catch((error) => {
  console.error('[RESET FATAL]', error);
  process.exit(1);
});