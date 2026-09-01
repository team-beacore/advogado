import { getPool } from '../db/client';
import { getCaptureAdapter } from './registry';
import { ProcessNormalizer } from './normalizer';
import { createPublication } from '../services/publicationService';
import { addEvent } from '../events/timeline';
import { auditLog } from '../audit/audit';
import { errors } from '../errors';
import { CAPTURE_ERROR_CODES, CAPTURE_ERROR_MESSAGES } from './types';
import type { CaptureAdapter, CaptureErrorCode } from './types';
import type { CaptureSource } from '@advogado/shared';

export type CaptureRunStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';

export interface CaptureRunCounters {
  found: number;
  imported: number;
  duplicate: number;
  errors: number;
}

export interface CaptureRunResult {
  runId: string;
  source: CaptureSource;
  status: CaptureRunStatus;
  found: number;
  imported: number;
  duplicate: number;
  errors: number;
  processesFound: number;
  movementsFound: number;
  publicationsFound: number;
  steps: Array<{ name: string; status: 'OK' | 'FAILED'; message?: string }>;
  errorMessage?: string | null;
  errorCode?: CaptureErrorCode | null;
}

async function getSourceConfig(organizationId: string, source: string): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const res = await pool.query('SELECT value FROM settings WHERE organization_id = $1 AND key = $2', [organizationId, `integration.capture.${source.toLowerCase()}`]);
  const value = res.rows[0]?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function createRun(organizationId: string, source: CaptureSource, mode: string, userId: string | null) {
  const pool = getPool();
  const res = await pool.query(
    `INSERT INTO capture_runs (organization_id, adapter, source, mode, status, started_at, created_by)
     VALUES ($1, $2, $2, $3, 'RUNNING', now(), $4) RETURNING id`,
    [organizationId, source, mode, userId],
  );
  return res.rows[0].id as string;
}

async function finishRun(
  runId: string,
  status: CaptureRunStatus,
  counters: CaptureRunCounters,
  errorMessage: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE capture_runs SET
       status = $2, found_count = $3, imported_count = $4, duplicate_count = $5,
       error_count = $6, error_message = $7, created_count = $4, skipped_count = $5,
       metadata = $8, finished_at = now()
     WHERE id = $1`,
    [runId, status, counters.found, counters.imported, counters.duplicate, counters.errors, errorMessage, JSON.stringify(metadata)],
  );
}

/** Busca processo pela número (escopo da organização). */
async function findProcessByNumber(organizationId: string, processNumber: string, userId?: string | null): Promise<{ id: string; created: boolean }> {
  const pool = getPool();
  const existing = await pool.query('SELECT id FROM cases WHERE organization_id = $1 AND process_number = $2', [organizationId, processNumber]);
  if (existing.rows.length > 0) return { id: existing.rows[0].id, created: false };

  const res = await pool.query(
    `INSERT INTO cases (organization_id, title, process_number, responsible_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [organizationId, `Processo ${processNumber}`, processNumber, userId ?? null],
  );
  const caseId = res.rows[0].id;
  if (userId) {
    await pool.query(
      `INSERT INTO case_members (case_id, user_id, role, can_view, can_edit, can_manage)
       VALUES ($1, $2, 'ADMIN', TRUE, TRUE, TRUE) ON CONFLICT (case_id, user_id) DO NOTHING`,
      [caseId, userId],
    );
  }
  return { id: caseId, created: true };
}

async function findProcessByNumberWithTitle(organizationId: string, np: { processNumber: string; title?: string | null }, userId?: string | null): Promise<{ id: string; created: boolean }> {
  const pool = getPool();
  const existing = await pool.query('SELECT id FROM cases WHERE organization_id = $1 AND process_number = $2', [organizationId, np.processNumber]);
  if (existing.rows.length > 0) return { id: existing.rows[0].id, created: false };
  const res = await pool.query(
    `INSERT INTO cases (organization_id, title, process_number, responsible_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [organizationId, np.title?.trim() || `Processo ${np.processNumber}`, np.processNumber, userId ?? null],
  );
  const caseId = res.rows[0].id;
  if (userId) {
    await pool.query(
      `INSERT INTO case_members (case_id, user_id, role, can_view, can_edit, can_manage)
       VALUES ($1, $2, 'ADMIN', TRUE, TRUE, TRUE) ON CONFLICT (case_id, user_id) DO NOTHING`,
      [caseId, userId],
    );
  }
  return { id: caseId, created: true };
}

/** Verifica se uma publicação já existe (idempotência) usando referência externa ou hash determinístico. */
async function existsPublication(organizationId: string, processId: string, externalReference: string | null | undefined, content: string): Promise<boolean> {
  const pool = getPool();
  if (externalReference) {
    const res = await pool.query(
      'SELECT id FROM legal_publications WHERE organization_id = $1 AND process_id = $2 AND external_reference = $3',
      [organizationId, processId, externalReference],
    );
    if (res.rows.length > 0) return true;
  }
  // Fallback determinístico: conteúdo exato
  const res = await pool.query(
    'SELECT id FROM legal_publications WHERE organization_id = $1 AND process_id = $2 AND content = $3',
    [organizationId, processId, content],
  );
  return res.rows.length > 0;
}

/** Verifica se uma movimentação já existe (idempotência). */
async function existsMovement(organizationId: string, processId: string, source: string, sourceReference: string | null | undefined, description: string): Promise<boolean> {
  const pool = getPool();
  if (sourceReference) {
    const res = await pool.query(
      `SELECT id FROM case_events WHERE process_id = $1 AND source = $2 AND source_reference = $3`,
      [processId, source, sourceReference],
    );
    if (res.rows.length > 0) return true;
  }
  const res = await pool.query(
    `SELECT id FROM case_events WHERE process_id = $1 AND title = $2 AND description = $3 AND source = $4`,
    [processId, description, description, source],
  );
  return res.rows.length > 0;
}

export interface RunCaptureOptions {
  retries?: number;
}

/**
 * Classifica um erro em um CaptureErrorCode padronizado.
 * Usado quando o adapter não informa explicitamente o código.
 */
function inferErrorCode(err: unknown, source: string, config: Record<string, unknown> | null): CaptureErrorCode {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  if (/\brate.?limit|429|too many requests/i.test(msg)) return CAPTURE_ERROR_CODES.RATE_LIMITED;
  if (/\btimeout|timed out|abort/i.test(msg)) return CAPTURE_ERROR_CODES.TIMEOUT;
  if (/authentication|auth|login|credential|401|403/i.test(msg)) return CAPTURE_ERROR_CODES.AUTHENTICATION_FAILED;
  if (!config || !Object.keys(config).length) return CAPTURE_ERROR_CODES.INVALID_CONFIGURATION;
  return CAPTURE_ERROR_CODES.SOURCE_UNAVAILABLE;
}

function captureError(errorCode: CaptureErrorCode, detail?: string): string {
  const base = CAPTURE_ERROR_MESSAGES[errorCode];
  return detail ? `${base} ${detail}` : base;
}

/**
 * Executa a captura de uma única fonte para uma organização.
 * Reutiliza publicationService (notificações), timeline e auditoria existentes.
 * A captura é idempotente por processo/publicação/movimentação.
 */
export async function runCapture(
  organizationId: string,
  source: CaptureSource,
  userId: string | null,
  ip?: string,
  opts: RunCaptureOptions = {},
): Promise<CaptureRunResult> {
  const adapter = getCaptureAdapter(source);
  if (!adapter) throw errors.validation(`Fonte de captura inválida: ${source}`);

  const mode = adapter.mode;
  const runId = await createRun(organizationId, source, mode, userId);
  const steps: CaptureRunResult['steps'] = [];
  const counters: CaptureRunCounters = { found: 0, imported: 0, duplicate: 0, errors: 0 };
  let processesFound = 0;
  let movementsFound = 0;
  let publicationsFound = 0;

  const config = await getSourceConfig(organizationId, source);

  // 1) Disponibilidade da fonte
  if (!adapter.implemented) {
    steps.push({ name: 'Disponibilidade', status: 'FAILED', message: `Fonte ${adapter.label} ainda não implementada.` });
    await finishRun(runId, 'FAILED', counters, `Fonte ${adapter.label} ainda não implementada.`, { mode, implemented: false });
    void auditLog({ organizationId, userId, action: 'CAPTURE_RUN', entity: 'capture_run', entityId: runId, after: { source, mode, status: 'FAILED', reason: 'NOT_IMPLEMENTED' }, ip, metadata: { implemented: false } });
    return { runId, source, status: 'FAILED', found: 0, imported: 0, duplicate: 0, errors: 1, processesFound: 0, movementsFound: 0, publicationsFound: 0, steps, errorMessage: `Fonte ${adapter.label} ainda não implementada.`, errorCode: CAPTURE_ERROR_CODES.SOURCE_UNAVAILABLE };
  }

  // 2) Configuração
  if (!adapter.isConfigured(config)) {
    steps.push({ name: 'Disponibilidade', status: 'OK', message: `${adapter.label} disponível` });
    steps.push({ name: 'Configuração', status: 'FAILED', message: `Fonte ${adapter.label} não configurada.` });
    await finishRun(runId, 'FAILED', counters, `Fonte ${adapter.label} não configurada.`, { mode });
    void auditLog({ organizationId, userId, action: 'CAPTURE_RUN', entity: 'capture_run', entityId: runId, after: { source, mode, status: 'FAILED', reason: 'NOT_CONFIGURED' }, ip });
    return { runId, source, status: 'FAILED', found: 0, imported: 0, duplicate: 0, errors: 1, processesFound: 0, movementsFound: 0, publicationsFound: 0, steps, errorMessage: `Fonte ${adapter.label} não configurada.`, errorCode: CAPTURE_ERROR_CODES.INVALID_CONFIGURATION };
  }

  steps.push({ name: 'Disponibilidade', status: 'OK', message: `${adapter.label} disponível` });
  steps.push({ name: 'Configuração', status: 'OK', message: 'Configuração válida' });

  // 3) Consulta (com timeout e retry limitado)
  const maxRetries = Math.max(0, Math.min(2, opts.retries ?? 1));
  let result: Awaited<ReturnType<CaptureAdapter['fetch']>> | null = null;
  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        result = await adapter.fetch(config!);
        break;
      } catch (e) {
        if (attempt >= maxRetries) throw e;
      }
    }
    if (!result) throw new Error('Consulta não retornou dados.');
    steps.push({ name: 'Consulta', status: 'OK', message: 'Consulta executada' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao consultar a fonte.';
    steps.push({ name: 'Consulta', status: 'FAILED', message: msg });
    counters.errors = 1;
    const errorCode = inferErrorCode(e, source, config);
    await finishRun(runId, 'FAILED', counters, msg, { mode, retries: maxRetries, errorCode });
    void auditLog({ organizationId, userId, action: 'CAPTURE_RUN', entity: 'capture_run', entityId: runId, after: { source, mode, status: 'FAILED', reason: errorCode }, ip, metadata: { error: msg } });
    return { runId, source, status: 'FAILED', found: 0, imported: 0, duplicate: 0, errors: 1, processesFound: 0, movementsFound: 0, publicationsFound: 0, steps, errorMessage: msg, errorCode };
  }

  // 4) Normalização
  const normalizer = new ProcessNormalizer(source, mode);
  const normalizedProcesses = result.processes.map((p) => normalizer.process(p));
  const normalizedMovements = result.movements.map((m) => normalizer.movement({ processNumber: m.processNumber, date: m.date ?? null, description: m.description, sourceReference: m.sourceReference }));
  const normalizedPublications = result.publications.map((p) => normalizer.publication({ processNumber: p.processNumber, content: p.content, publicationDate: p.publicationDate ?? null, availabilityDate: p.availabilityDate ?? null, externalReference: p.externalReference ?? null, possibleDueDate: p.possibleDueDate ?? null, notes: p.notes ?? null }));
  steps.push({ name: 'Normalização', status: 'OK', message: 'Dados normalizados' });

  processesFound = normalizedProcesses.length;
  movementsFound = normalizedMovements.length;
  publicationsFound = normalizedPublications.length;
  counters.found = publicationsFound;

  // 5) Persistência (idempotente)
  const processIds = new Map<string, string>();
  for (const proc of normalizedProcesses) {
    try {
      const found = await findProcessByNumberWithTitle(organizationId, proc, userId);
      processIds.set(proc.processNumber, found.id);
      if (found.created) counters.imported += 1;
      else counters.duplicate += 1;
    } catch {
      counters.errors += 1;
    }
  }

  for (const mov of normalizedMovements) {
    try {
      const processId = processIds.get(mov.processNumber);
      if (!processId) { counters.errors += 1; continue; }
      if (await existsMovement(organizationId, processId, source, mov.sourceReference, mov.description)) {
        counters.duplicate += 1;
        continue;
      }
      await addEvent({
        processId,
        type: 'CAPTURE_MOVEMENT',
        title: mov.description,
        description: mov.description,
        source,
        sourceReference: mov.sourceReference,
        createdBy: userId,
      });
      counters.imported += 1;
    } catch {
      counters.errors += 1;
    }
  }

  for (const pub of normalizedPublications) {
    try {
      const processId = processIds.get(pub.processNumber);
      if (!processId) { counters.errors += 1; continue; }
      if (await existsPublication(organizationId, processId, pub.externalReference, pub.content)) {
        counters.duplicate += 1;
        continue;
      }
      await createPublication(
        organizationId,
        {
          processId,
          source: `${source}`,
          availabilityDate: pub.availabilityDate,
          publicationDate: pub.publicationDate,
          content: pub.content,
          externalReference: pub.externalReference,
          possibleDueDate: pub.possibleDueDate,
          notes: pub.notes,
        },
        userId,
        ip,
      );
      counters.imported += 1;
    } catch {
      counters.errors += 1;
    }
  }

  steps.push({ name: 'Persistência', status: 'OK', message: 'Dados persistidos' });

  const status: CaptureRunStatus = counters.errors > 0 ? 'PARTIAL' : 'SUCCESS';
  steps.push({ name: 'Finalização', status: status === 'SUCCESS' ? 'OK' : 'FAILED', message: status === 'SUCCESS' ? 'Captura concluída' : 'Concluída com erros' });

  await finishRun(runId, status, counters, counters.errors > 0 ? 'Captura concluída com erros.' : null, {
    mode,
    processesFound,
    movementsFound,
    publicationsFound,
    demo: source === 'DEMO',
  });

  void auditLog({
    organizationId,
    userId,
    action: 'CAPTURE_RUN',
    entity: 'capture_run',
    entityId: runId,
    after: { source, mode, status, found: counters.found, imported: counters.imported, duplicate: counters.duplicate, errors: counters.errors },
    ip,
    metadata: { processesFound, movementsFound, publicationsFound },
  });

  return {
    runId,
    source,
    status,
    found: counters.found,
    imported: counters.imported,
    duplicate: counters.duplicate,
    errors: counters.errors,
    processesFound,
    movementsFound,
    publicationsFound,
    steps,
    errorMessage: counters.errors > 0 ? 'Captura concluída com erros.' : null,
    errorCode: (status as CaptureRunStatus) === 'FAILED' ? CAPTURE_ERROR_CODES.UNKNOWN_ERROR : null,
  };
}

/**
 * Teste de conexão real com a fonte. Não considera "configuração salva" como "conectado".
 * Para fontes não implementadas retorna falha honesta.
 */
export async function testSourceConnection(organizationId: string, source: CaptureSource, config?: Record<string, unknown>): Promise<{ ok: boolean; message: string; details?: string[]; source: CaptureSource; mode: string }> {
  const adapter = getCaptureAdapter(source);
  if (!adapter) throw errors.validation(`Fonte de captura inválida: ${source}`);

  if (!adapter.implemented) {
    const r = await adapter.testConnection(config ?? {});
    void auditLog({ organizationId, userId: null, action: 'CAPTURE_TEST', entity: 'capture', entityId: source, after: { source, mode: adapter.mode, ok: false, reason: 'NOT_IMPLEMENTED' } });
    return { ok: false, message: r.message, details: r.details, source, mode: adapter.mode };
  }

  const cfg = config ?? await getSourceConfig(organizationId, source);
  const r = await adapter.testConnection(cfg ?? {});
  void auditLog({ organizationId, userId: null, action: 'CAPTURE_TEST', entity: 'capture', entityId: source, after: { source, mode: adapter.mode, ok: r.ok }, metadata: { details: r.details } });
  return { ok: r.ok, message: r.message, details: r.details, source, mode: adapter.mode };
}

export async function getCaptureStatus(organizationId: string): Promise<{ adapters: Array<{ source: string; mode: string; implemented: boolean; configured: boolean; enabled: boolean; label: string }> }> {
  const { getCaptureAdapters } = await import('./registry');
  const adapters = getCaptureAdapters();
  const items = await Promise.all(
    adapters.map(async (adapter) => {
      const config = await getSourceConfig(organizationId, adapter.source);
      return {
        source: adapter.source,
        mode: adapter.mode,
        implemented: adapter.implemented,
        configured: adapter.implemented && adapter.isConfigured(config),
        enabled: config?.enabled === false ? false : true,
        label: adapter.label,
      };
    }),
  );
  return { adapters: items };
}

export async function saveSourceConfig(organizationId: string, source: string, config: Record<string, unknown>): Promise<void> {
  const pool = getPool();
  const existing = await getSourceConfig(organizationId, source);
  const password = typeof config.password === 'string' && config.password && config.password !== 'placeholder'
    ? config.password
    : (existing?.password ?? null);
  const merged = {
    enabled: config.enabled ?? existing?.enabled ?? true,
    login: typeof config.login === 'string' && config.login ? config.login : (existing?.login ?? null),
    password,
    baseUrl: config.baseUrl ?? existing?.baseUrl ?? null,
  };
  await pool.query(
    `INSERT INTO settings (organization_id, key, value, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [organizationId, `integration.capture.${source.toLowerCase()}`, JSON.stringify(merged)],
  );
}

export async function listSourceConfigs(organizationId: string): Promise<Array<{
  source: string;
  mode: string;
  implemented: boolean;
  enabled: boolean;
  configured: boolean;
  login: string | null;
  passwordSet: boolean;
  baseUrl: string | null;
}>> {
  const { getCaptureAdapters } = await import('./registry');
  const adapters = getCaptureAdapters();
  const items = await Promise.all(
    adapters.map(async (adapter) => {
      const config = await getSourceConfig(organizationId, adapter.source);
      return {
        source: adapter.source,
        mode: adapter.mode,
        implemented: adapter.implemented,
        enabled: Boolean(config?.enabled),
        configured: adapter.implemented && adapter.isConfigured(config),
        login: typeof config?.login === 'string' && config.login ? (config.login as string) : null,
        passwordSet: typeof config?.password === 'string' && Boolean(config.password),
        baseUrl: typeof config?.baseUrl === 'string' && config.baseUrl ? (config.baseUrl as string) : null,
      };
    }),
  );
  return items;
}

export async function deleteSourceConfig(organizationId: string, source: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM settings WHERE organization_id = $1 AND key = $2', [organizationId, `integration.capture.${source.toLowerCase()}`]);
}

/** Lista execuções de captura da organização (para tela de detalhes). */
export async function listCaptureRuns(organizationId: string, opts: { page?: number; pageSize?: number }) {
  const pool = getPool();
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const res = await pool.query(
    `SELECT r.*, u.name AS user_name FROM capture_runs r
     LEFT JOIN users u ON u.id = r.created_by
     WHERE r.organization_id = $1
     ORDER BY r.started_at DESC LIMIT $2 OFFSET $3`,
    [organizationId, pageSize, (page - 1) * pageSize],
  );
  const countRes = await pool.query('SELECT count(*)::int AS total FROM capture_runs WHERE organization_id = $1', [organizationId]);
  return { items: res.rows, total: countRes.rows[0]?.total ?? 0, page, pageSize };
}

/**
 * Remove somente dados de captura de demonstração (source DEMO + processos demo).
 * Nunca remove dados reais.
 */
export async function cleanupDemoData(organizationId: string): Promise<{ removedPublications: number; removedEvents: number; removedCases: number }> {
  const pool = getPool();
  // Publicações da fonte DEMO
  const pubs = await pool.query(`DELETE FROM legal_publications WHERE organization_id = $1 AND source = 'DEMO' RETURNING id`, [organizationId]);
  // Processos cujo process_number pertence ao conjunto demo e não possuem publicações não-demo
  const cases = await pool.query(
    `DELETE FROM cases c WHERE c.organization_id = $1
     AND c.process_number LIKE '000000%-%.2026.8.00.000%'
     AND NOT EXISTS (SELECT 1 FROM legal_publications p WHERE p.process_id = c.id AND p.source <> 'DEMO')
     RETURNING id`,
    [organizationId],
  );
  const events = await pool.query(`DELETE FROM case_events e USING cases c WHERE c.id = e.process_id AND c.organization_id = $1 AND e.source = 'DEMO' RETURNING e.id`, [organizationId]);
  return { removedPublications: pubs.rows.length, removedCases: cases.rows.length, removedEvents: events.rows.length };
}

export { findProcessByNumber, existsPublication as _existsPublication, getSourceConfig as _getSourceConfig };
