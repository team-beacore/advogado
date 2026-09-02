import { createApp } from './app';
import { loadEnv } from './config';
import { getPool, connectionOk, closePool } from './db/client';
import { runMigrations } from './db/migrate';
import { ensureDatabaseStarted } from './db/startEmbedded';
import { getMonitorScheduler, stopMonitorScheduler } from './capture/scheduler/service';

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

  // Bootstrap SUPER ADMIN da plataforma (usuário implantador, sem vínculo com organização)
  const envConf = loadEnv();
  if (envConf.SUPER_ADMIN_EMAIL && envConf.SUPER_ADMIN_PASSWORD) {
    try {
      const { ScryptHasher } = await import('./auth/password');
      const hasher = new ScryptHasher();
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [envConf.SUPER_ADMIN_EMAIL]);
      if (existing.rows.length === 0) {
        const hash = hasher.hash(envConf.SUPER_ADMIN_PASSWORD);
        await pool.query(
          `INSERT INTO users (name, email, password_hash, is_super_admin) VALUES ($1, $2, $3, TRUE)`,
          [envConf.SUPER_ADMIN_NAME, envConf.SUPER_ADMIN_EMAIL, hash],
        );
        console.log('SUPER ADMIN criado:', envConf.SUPER_ADMIN_EMAIL);
      }
    } catch (e) {
      console.log('Aviso: bootstrap SUPER ADMIN falhou (pode já existir ou não há DB):', (e as Error).message);
    }
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`API rodando em http://localhost:${env.PORT}`);
  });

  // Monitor automático de processos (orquestra syncCase). Desabilitado por
  // padrão; habilite com PROCESS_MONITOR_ENABLED=true em produção.
  if (env.PROCESS_MONITOR_ENABLED === 'true') {
    try {
      getMonitorScheduler().start();
    } catch (e) {
      console.log('Aviso: falha ao iniciar scheduler de monitoramento:', (e as Error).message);
    }
  }

  const shutdown = async () => {
    console.log('\nDesligando...');
    stopMonitorScheduler();
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