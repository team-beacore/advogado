import { createApp } from './app';
import { loadEnv } from './config';
import { getPool, connectionOk, closePool } from './db/client';
import { runMigrations } from './db/migrate';
import { ensureDatabaseStarted } from './db/startEmbedded';

async function main() {
  const env = loadEnv();
  console.log(`Environment: ${env.NODE_ENV}`);
  console.log(`Storage: ${env.STORAGE_DRIVER} (${env.STORAGE_DIR})`);

  let dbOk = await connectionOk();
  if (!dbOk) {
    console.log('Banco de dados não disponível. Tentando iniciar PostgreSQL embarcado...');
    const started = await ensureDatabaseStarted();
    if (!started) {
      console.error('Falha ao iniciar banco de dados. Configure DATABASE_URL corretamente.');
      process.exit(1);
    }
    dbOk = await connectionOk();
    if (!dbOk) {
      console.error('Banco de dados não responde após inicialização.');
      process.exit(1);
    }
    console.log('PostgreSQL embarcado iniciado com sucesso.');
  }

  console.log('Banco de dados conectado.');
  const pool = getPool();
  const applied = await runMigrations(pool);
  if (applied.length > 0) {
    console.log('Migrações aplicadas:', applied.join(', '));
  } else {
    console.log('Migrações em dia.');
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`API rodando em http://localhost:${env.PORT}`);
  });

  const shutdown = async () => {
    console.log('\nDesligando...');
    server.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Falha ao iniciar servidor:', err);
  process.exit(1);
});