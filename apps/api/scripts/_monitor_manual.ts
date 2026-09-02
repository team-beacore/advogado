import request from 'supertest';
import { createApp } from '../src/app';
import { getPool } from '../src/db/client';
import { createMonitorScheduler, stopMonitorScheduler } from '../src/capture/scheduler/service';

const BASE = 'https://api-publica.datajud.cnj.jus.br';
const CNJ = '0000832-35.2018.4.01.3202';

async function main() {
  const app = createApp();
  const pool = getPool();
  console.log('== TESTE MANUAL CONTROLADO — Scheduler + DataJud real ==');

  // 1. Org/usuário
  const email = `sched_${Date.now()}@test.local`;
  await request(app).post('/api/auth/register').send({ name: 'Sched Test', email, password: 'test1234' }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'test1234' }).expect(200);
  const cookie = login.headers['set-cookie']?.[0]?.split(';')[0]!;
  let orgId = login.body.organizationId;
  if (!orgId) {
    const org = await request(app).post('/api/organizations').set('Cookie', cookie).send({ name: 'Org' }).expect(201);
    orgId = org.body.id;
    await request(app).post('/api/auth/switch-org').set('Cookie', cookie).send({ organizationId: orgId }).expect(200);
  }

  // 2. Chave pública do DataJud (wiki CNJ) — nunca impressa
  const wiki = await fetch('https://datajud-wiki.cnj.jus.br/api-publica/acesso/', { signal: AbortSignal.timeout(15000) });
  const html = await wiki.text();
  const key = html.match(/c[A-Za-z0-9+/=]{50,}/)?.[0];
  if (!key) { console.log('FATAL: chave não obtida'); process.exit(1); }
  await pool.query(
    `INSERT INTO settings (organization_id, key, value, updated_at) VALUES ($1, 'integration.capture.datajud', $2, now())
     ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [orgId, JSON.stringify({ enabled: true, password: key, baseUrl: BASE })],
  );

  // 3. Case com número real
  const caseRes = await request(app).post('/api/processes').set('Cookie', cookie).send({ title: 'Processo Monitor', processNumber: CNJ }).expect(201);
  const caseId = caseRes.body.id;
  console.log('caseId:', caseId, 'process:', CNJ);

  // 4. Primeira execução do scheduler (chama syncCase real)
  console.log('\n--- 1ª execução scheduler ---');
  const s1 = createMonitorScheduler({ enabled: true, intervalMinutes: 60, concurrency: 1 });
  const r1 = await s1.runOnce();
  console.log('eligible:', r1.eligible, 'started:', r1.started, 'success:', r1.success, 'failed:', r1.failed, 'newEvents:', r1.newEvents, 'skipped:', r1.skipped);
  stopMonitorScheduler();

  const runRow1 = await pool.query(`SELECT r.source, r.adapter, r.status, r.case_id, r.found_count, r.imported_count, r.duplicate_count, r.error_count, r.error_message, r.metadata FROM capture_runs r WHERE r.case_id = $1 AND r.adapter='SYNC' ORDER BY r.started_at DESC LIMIT 1`, [caseId]);
  console.log('capture_run:', JSON.stringify(runRow1.rows[0], (k, v) => k === 'password' || (typeof v === 'string' && v.length > 40 && /^c[A-Za-z0-9+/=]/.test(v)) ? '(hidden)' : v));
  const caseCheck1 = await pool.query('SELECT monitoring_status, last_synced_at, last_sync_error FROM cases WHERE id = $1', [caseId]);
  console.log('case status:', JSON.stringify(caseCheck1.rows[0]));

  // 5. Segunda execução (idempotência — 0 novos esperados)
  console.log('\n--- 2ª execução scheduler ---');
  const s2 = createMonitorScheduler({ enabled: true, intervalMinutes: 60, concurrency: 1 });
  const r2 = await s2.runOnce();
  console.log('eligible:', r2.eligible, 'started:', r2.started, 'success:', r2.success, 'failed:', r2.failed, 'newEvents:', r2.newEvents, 'skipped:', r2.skipped);
  stopMonitorScheduler();

  const runRow2 = await pool.query(`SELECT r.status, r.found_count, r.imported_count, r.duplicate_count FROM capture_runs r WHERE r.case_id = $1 AND r.adapter='SYNC' ORDER BY r.started_at DESC LIMIT 1`, [caseId]);
  console.log('2ª capture_run:', JSON.stringify(runRow2.rows[0]));

  console.log('\nRESULTADO: scheduler orquestrou syncCase real com sucesso.');
  process.exit(0);
}
main().catch((e) => { console.error('FALHA:', e.message); process.exit(1); });