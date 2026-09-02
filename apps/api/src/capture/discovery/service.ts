import { getPool } from '../../db/client';
import { getDiscoveryProvider, getDiscoveryProviders } from './registry';
import type { ProcessDiscoveryProvider, DiscoveredProcess } from './types';
import { auditLog } from '../../audit/audit';
import { addEvent } from '../../events/timeline';
import { createPublication } from '../../services/publicationService';
import { errors } from '../../errors';
import type { CaptureSource, DiscoveryStatus } from '@advogado/shared';
import { _getSourceConfig } from '../service';
import { DiscoveryRouter } from './router';
import { aggregateProcesses } from './aggregator';

export type DiscoveryRunStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';

export interface DiscoveryRunResult {
  runId: string;
  source: CaptureSource;
  status: DiscoveryRunStatus;
  processesFound: number;
  resultsCreated: number;
  resultsDuplicate: number;
  sourcesSkipped: number;
  steps: Array<{ name: string; status: 'OK' | 'SKIPPED' | 'FAILED'; message?: string }>;
  errorMessage?: string | null;
}

async function createRun(organizationId: string, source: CaptureSource, mode: string, userId: string | null) {
  const pool = getPool();
  const res = await pool.query(
    `INSERT INTO capture_runs (organization_id, adapter, source, mode, status, started_at, created_by)
     VALUES ($1, 'DISCOVERY', $2, $3, 'RUNNING', now(), $4) RETURNING id`,
    [organizationId, source, mode, userId],
  );
  return res.rows[0].id as string;
}

async function finishRun(
  runId: string,
  status: DiscoveryRunStatus,
  counters: { found: number; imported: number; duplicate: number; errors: number },
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

/** Busca identidade profissional ativa de um usuário na organização. */
async function getIdentityByUser(organizationId: string, userId: string) {
  const pool = getPool();
  const res = await pool.query(
    'SELECT id, professional_name, oab_number, oab_state, identifiers, metadata FROM professional_identities WHERE organization_id = $1 AND user_id = $2 LIMIT 1',
    [organizationId, userId],
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    professionalName: r.professional_name,
    oabNumber: r.oab_number,
    oabState: r.oab_state,
    identifiers: r.identifiers ?? null,
    metadata: r.metadata ?? null,
  };
}

/** Verifica se um processo descoberto já existe como Case na organização (dedup por número CNJ). */
async function caseExistsByNumber(organizationId: string, processNumber: string): Promise<boolean> {
  const pool = getPool();
  const res = await pool.query('SELECT id FROM cases WHERE organization_id = $1 AND process_number = $2', [organizationId, processNumber]);
  return res.rows.length > 0;
}

/** Verifica se um resultado de descoberta já existe para o processo (dedup por CNJ na organização). */
async function resultExists(organizationId: string, processNumber: string): Promise<boolean> {
  const pool = getPool();
  const res = await pool.query(
    'SELECT id, source, metadata FROM process_discovery_results WHERE organization_id = $1 AND process_number = $2 LIMIT 1',
    [organizationId, processNumber],
  );
  return res.rows.length > 0;
}

async function persistResults(organizationId: string, identityId: string | null, runId: string | null, processes: DiscoveredProcess[], userId: string | null): Promise<{ created: number; duplicate: number }> {
  const pool = getPool();
  let created = 0;
  let duplicate = 0;
  for (const p of processes) {
    if (!p.processNumber) continue;
    if (await caseExistsByNumber(organizationId, p.processNumber)) { duplicate += 1; continue; }
    if (await resultExists(organizationId, p.processNumber)) { duplicate += 1; continue; }

    // Fonte primária = primeira fonte que encontrou (lista completa fica em metadata.sources)
    const sources = (p.sources?.length ? p.sources : [p.source]) as CaptureSource[];
    const primarySource = sources[0]!;
    const confidence = p.confidence ?? 'UNKNOWN';

    await pool.query(
      `INSERT INTO process_discovery_results
         (organization_id, professional_identity_id, run_id, source, process_number, court, court_code,
          judicial_system, external_process_id, title, area, class, subjects, last_movement, last_movement_at,
          status, confidence, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'PENDING_REVIEW', $16, $17, $18)`,
      [
        organizationId,
        identityId,
        runId,
        primarySource,
        p.processNumber,
        p.court ?? null,
        p.courtCode ?? null,
        p.judicialSystem ?? null,
        p.externalProcessId ?? null,
        p.title ?? null,
        p.area ?? null,
        p.class ?? null,
        p.subjects ? JSON.stringify(p.subjects) : null,
        p.lastMovement ?? null,
        p.lastMovementAt ? new Date(p.lastMovementAt).toISOString() : null,
        confidence === 'HIGH' ? 1 : confidence === 'MEDIUM' ? 0.5 : confidence === 'LOW' ? 0.2 : 0,
        p.metadata || p.movements || p.publications || p.parties || sources.length > 1
          ? JSON.stringify({
              ...(p.metadata ?? {}),
              sources,
              confidence,
              parties: p.parties ?? [],
              movements: p.movements ?? [],
              publications: p.publications ?? [],
            })
          : null,
        userId,
      ],
    );
    created += 1;
  }
  return { created, duplicate };
}

export interface RunDiscoveryOptions {
  /** Identidade profissional específica (padrão: identidade do usuário logado). */
  professionalIdentityId?: string;
}

function skipMessage(reason: string): string {
  switch (reason) {
    case 'NOT_IMPLEMENTED': return 'Fonte ainda não implementada.';
    case 'NO_PROFESSIONAL_DISCOVERY': return 'Fonte não oferece descoberta por profissional.';
    case 'NOT_CONFIGURED': return 'Fonte não configurada.';
    default: return `Fonte não utilizada (${reason}).`;
  }
}

/**
 * Executa a descoberta de processos para a organização.
 * Reutiliza capture_runs para registro. Para cada fonte consultada:
 *  - se a fonte não suporta descoberta por profissional, registra SKIPPED (honesto);
 *  - se suporta, executa a consulta e persiste resultados como PENDING_REVIEW;
 *  - nunca inventa resultados quando a fonte não oferece a capacidade.
 */
export async function runDiscovery(organizationId: string, source: CaptureSource | undefined, userId: string, ip?: string, opts: RunDiscoveryOptions = {}): Promise<DiscoveryRunResult> {
  const providers = source ? (getDiscoveryProvider(source) ? [getDiscoveryProvider(source)!] : []) : getDiscoveryProviders();
  if (providers.length === 0) throw errors.validation(`Fonte de descoberta inválida: ${source}`);

  const steps: DiscoveryRunResult['steps'] = [];
  let processesFound = 0;
  let resultsCreated = 0;
  let resultsDuplicate = 0;
  let sourcesSkipped = 0;
  let errorsCount = 0;
  let lastError: string | null = null;

  let identityId: string | null = null;
  let identity = await getIdentityByUser(organizationId, userId);
  if (!identity && opts.professionalIdentityId) {
    const pool = getPool();
    const res = await pool.query(
      'SELECT id, professional_name, oab_number, oab_state, identifiers, metadata FROM professional_identities WHERE id = $1 AND organization_id = $2',
      [opts.professionalIdentityId, organizationId],
    );
    if (res.rows.length > 0) {
      const r = res.rows[0];
      identity = { id: r.id, professionalName: r.professional_name, oabNumber: r.oab_number, oabState: r.oab_state, identifiers: r.identifiers ?? null, metadata: r.metadata ?? null };
    }
  }
  if (!identity) {
    throw errors.validation('Identidade profissional não configurada. Cadastre sua OAB/UF antes de executar a descoberta.');
  }
  identityId = identity.id;

  // Usa a primeira fonte como run principal (para registro em capture_runs).
  const primary = providers[0]!;
  const runId = await createRun(organizationId, primary.source, primary.mode, userId);

  // DiscoveryRouter: avalia elegibilidade e executa providers comprovados.
  const router = new DiscoveryRouter({ configLoader: (s) => _getSourceConfig(organizationId, s) });
  const routerSteps = await router.route(identity, providers);

  // Coleta processos de steps bem-sucedidos e agrega (dedup por CNJ, merge sources).
  const allProcesses: DiscoveredProcess[] = [];
  for (const step of routerSteps) {
    if (step.status === 'OK' && step.processes) {
      allProcesses.push(...step.processes);
    }
  }
  const aggregated = aggregateProcesses(allProcesses);

  // Persiste resultados agregados (dedup por CNJ na organização, não por fonte).
  const persisted = await persistResults(organizationId, identityId, runId, aggregated, userId);

  // Constrói steps/contadores para a resposta.
  for (const step of routerSteps) {
    const label = step.provider.label;
    const source = step.provider.source as string;
    if (step.status === 'SKIPPED') {
      const reason = step.reason ?? 'unknown';
      steps.push({ name: label, status: 'SKIPPED', message: skipMessage(reason) });
      sourcesSkipped += 1;
      void auditLog({ organizationId, userId, action: 'PROCESS_DISCOVERY_SOURCE', entity: 'capture_run', entityId: runId, after: { source, ok: false, reason }, ip });
    } else if (step.status === 'FAILED') {
      const msg = step.error?.message ?? 'Falha ao consultar a fonte.';
      steps.push({ name: label, status: 'FAILED', message: msg });
      errorsCount += 1;
      lastError = msg;
      void auditLog({ organizationId, userId, action: 'PROCESS_DISCOVERY_SOURCE', entity: 'capture_run', entityId: runId, after: { source, ok: false, reason: step.reason ?? 'ERROR' }, ip });
    } else {
      steps.push({ name: label, status: 'OK', message: `${step.processes?.length ?? 0} processo(s) encontrado(s)` });
      void auditLog({ organizationId, userId, action: 'PROCESS_DISCOVERY_SOURCE', entity: 'capture_run', entityId: runId, after: { source, ok: true, found: step.processes?.length ?? 0, created: persisted.created, duplicate: persisted.duplicate }, ip });
    }
  }
  // processesFound = processos únicos após agregação (um por número CNJ).
  processesFound = aggregated.length;
  resultsCreated = persisted.created;
  resultsDuplicate = persisted.duplicate;

  const status: DiscoveryRunStatus = errorsCount > 0
    ? (resultsCreated > 0 || processesFound > 0 ? 'PARTIAL' : 'FAILED')
    : (processesFound > 0 ? 'SUCCESS' : 'PARTIAL');
  await finishRun(
    runId,
    status,
    { found: processesFound, imported: resultsCreated, duplicate: resultsDuplicate, errors: errorsCount },
    lastError,
    { kind: 'DISCOVERY', professionalIdentityId: identityId, steps: steps.map((s) => ({ name: s.name, status: s.status })) },
  );

  void auditLog({
    organizationId,
    userId,
    action: 'PROCESS_DISCOVERY_RUN',
    entity: 'capture_run',
    entityId: runId,
    after: { source: primary.source, status, found: processesFound, created: resultsCreated, duplicate: resultsDuplicate, errors: errorsCount },
    ip,
    metadata: { professionalIdentityId: identityId },
  });

  return {
    runId,
    source: primary.source,
    status,
    processesFound,
    resultsCreated,
    resultsDuplicate,
    sourcesSkipped,
    steps,
    errorMessage: lastError,
  };
}

export async function listDiscoveryResults(organizationId: string, opts: { page?: number; pageSize?: number; status?: DiscoveryStatus; source?: string; confidence?: string; processNumber?: string; court?: string; discoveredFrom?: string; discoveredTo?: string }) {
  const pool = getPool();
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const where: string[] = ['r.organization_id = $1'];
  const params: unknown[] = [organizationId];
  if (opts.status) {
    params.push(opts.status);
    where.push(`r.status = $${params.length}`);
  }
  if (opts.source) {
    params.push(opts.source);
    where.push(`r.source = $${params.length}`);
  }
  if (opts.processNumber) {
    params.push(`%${opts.processNumber}%`);
    where.push(`r.process_number ILIKE $${params.length}`);
  }
  if (opts.court) {
    params.push(`%${opts.court}%`);
    where.push(`COALESCE(r.court, '') ILIKE $${params.length}`);
  }
  if (opts.confidence) {
    params.push(opts.confidence);
    where.push(`COALESCE(r.metadata->>'confidence', '') = $${params.length}`);
  }
  if (opts.discoveredFrom) {
    params.push(opts.discoveredFrom);
    where.push(`r.discovered_at >= $${params.length}`);
  }
  if (opts.discoveredTo) {
    params.push(opts.discoveredTo);
    where.push(`r.discovered_at <= $${params.length}`);
  }

  const res = await pool.query(
    `SELECT r.*,
            pi.professional_name AS identity_professional_name,
            pi.oab_number AS identity_oab_number,
            pi.oab_state AS identity_oab_state,
            u.name AS created_by_name,
            c.id AS existing_case_id,
            c.title AS existing_case_title
     FROM process_discovery_results r
     LEFT JOIN professional_identities pi ON pi.id = r.professional_identity_id
     LEFT JOIN users u ON u.id = r.created_by
     LEFT JOIN cases c ON c.organization_id = r.organization_id AND c.process_number = r.process_number
     WHERE ${where.join(' AND ')}
     ORDER BY r.discovered_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  const countRes = await pool.query(`SELECT count(*)::int AS total FROM process_discovery_results r WHERE ${where.join(' AND ')}`, params);
  return { items: res.rows, total: countRes.rows[0]?.total ?? 0, page, pageSize };
}

/**
 * Detalhe de um resultado de descoberta, enriquecido com:
 *  - identidade profissional relacionada;
 *  - contagem de movimentações/publicações disponíveis na descoberta;
 *  - se já existe Case com o mesmo CNJ (DUPLICATE candidate);
 *  - "possível cliente" (partes) SEM criar cliente automaticamente.
 */
export async function getDiscoveryResultDetail(organizationId: string, id: string) {
  const pool = getPool();
  const res = await pool.query(
    `SELECT r.*,
            pi.professional_name AS identity_professional_name,
            pi.oab_number AS identity_oab_number,
            pi.oab_state AS identity_oab_state,
            pi.user_id AS identity_user_id,
            c.id AS existing_case_id,
            c.title AS existing_case_title,
            c.client_id AS existing_case_client_id
     FROM process_discovery_results r
     LEFT JOIN professional_identities pi ON pi.id = r.professional_identity_id
     LEFT JOIN cases c ON c.organization_id = r.organization_id AND c.process_number = r.process_number
     WHERE r.id = $1 AND r.organization_id = $2`,
    [id, organizationId],
  );
  if (res.rows.length === 0) throw errors.notFound('Resultado de descoberta não encontrado.');
  const row = res.rows[0];

  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const movements = Array.isArray(metadata.movements) ? metadata.movements : [];
  const publications = Array.isArray(metadata.publications) ? metadata.publications : [];
  const sources = Array.isArray(metadata.sources) ? metadata.sources : [row.source];
  const parties = Array.isArray(metadata.parties) ? metadata.parties : [];

  return {
    ...row,
    confidence: row.confidence,
    sources,
    movementsCount: movements.length,
    publicationsCount: publications.length,
    parties,
    suggestedResponsible: row.identity_user_id
      ? { userId: row.identity_user_id, professionalName: row.identity_professional_name ?? null, oabNumber: row.identity_oab_number ?? null, oabState: row.identity_oab_state ?? null }
      : null,
    possibleClient: parties.length > 0
      ? parties.map((p) => ({ name: p, confirmed: false }))
      : [],
  };
}

export async function getDiscoveryResult(organizationId: string, id: string) {
  const pool = getPool();
  const res = await pool.query('SELECT * FROM process_discovery_results WHERE id = $1 AND organization_id = $2', [id, organizationId]);
  if (res.rows.length === 0) throw errors.notFound('Resultado de descoberta não encontrado.');
  return res.rows[0];
}

export async function listDiscoveryRuns(organizationId: string, opts: { page?: number; pageSize?: number }) {
  const pool = getPool();
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const res = await pool.query(
    `SELECT r.*, u.name AS user_name FROM capture_runs r
     LEFT JOIN users u ON u.id = r.created_by
     WHERE r.organization_id = $1 AND r.adapter = 'DISCOVERY'
     ORDER BY r.started_at DESC LIMIT $2 OFFSET $3`,
    [organizationId, pageSize, (page - 1) * pageSize],
  );
  const countRes = await pool.query(`SELECT count(*)::int AS total FROM capture_runs WHERE organization_id = $1 AND adapter = 'DISCOVERY'`, [organizationId]);
  return { items: res.rows, total: countRes.rows[0]?.total ?? 0, page, pageSize };
}

export async function updateDiscoveryResultStatus(organizationId: string, id: string, status: DiscoveryStatus, userId: string): Promise<{ id: string; status: string }> {
  const result = await getDiscoveryResult(organizationId, id);
  if (result.status === 'IMPORTED') throw errors.validation('Resultado já importado não pode ser alterado.');
  const pool = getPool();
  await pool.query(
    `UPDATE process_discovery_results SET status = $1, updated_at = now() WHERE id = $2 AND organization_id = $3`,
    [status, id, organizationId],
  );
  const action = status === 'REJECTED' ? 'PROCESS_DISCOVERY_REJECTED' : 'PROCESS_DISCOVERY_REVIEWED';
  void auditLog({ organizationId, userId, action, entity: 'process_discovery_result', entityId: id, after: { previousStatus: result.status, status }, metadata: { processNumber: result.process_number } });
  return { id, status };
}

/** Verifica se uma movimentação já existe para o processo (idempotência na importação). */
async function existsMovement(processId: string, source: string, sourceReference: string | null | undefined, description: string): Promise<boolean> {
  const pool = getPool();
  if (sourceReference) {
    const res = await pool.query(
      'SELECT id FROM case_events WHERE process_id = $1 AND source = $2 AND source_reference = $3',
      [processId, source, sourceReference],
    );
    if (res.rows.length > 0) return true;
  }
  const res = await pool.query(
    'SELECT id FROM case_events WHERE process_id = $1 AND title = $2 AND description = $3 AND source = $4',
    [processId, description, description, source],
  );
  return res.rows.length > 0;
}

export interface ImportDiscoveryResultOptions {
  responsibleId?: string | null;
  /** Cliente existente da instalação. */
  clientId?: string | null;
  /** Cria novo cliente (nunca silenciosamente; exige confirmação). */
  newClient?: { name: string; email?: string | null; phone?: string | null; cpfCnpj?: string | null; notes?: string | null } | null;
  /** Em SOLO, responsável padrão é o advogado da instalação. */
  defaultResponsibleId?: string | null;
}

/**
 * Importa um processo descoberto para a plataforma (Cria/atualiza Case).
 * Idempotente: se já existe Case com o mesmo número CNJ na organização, marca o
 * resultado como DUPLICATE e vincula o Case existente (sem criar outro).
 *
 * Responsável:
 *  - explicitamente informado (responsibleId) tem prioridade;
 *  - em SOLO, usa defaultResponsibleId (o advogado da instalação);
 *  - caso contrário, fica null — nunca assume que quem importou é responsável.
 *
 * Cliente:
 *  - clientId: associa cliente existente (validado na organização);
 *  - newClient: cria cliente novo somente se explicitamente confirmado;
 *  - ambos ausentes: importa sem cliente (nunca cria cliente automaticamente).
 *
 * A operação é transacional e registra auditoria.
 */
export async function importDiscoveryResult(organizationId: string, id: string, userId: string, ip?: string, opts: ImportDiscoveryResultOptions = {}) {
  const result = await getDiscoveryResult(organizationId, id);
  const pool = getPool();

  if (result.status === 'IMPORTED' && result.imported_case_id) {
    return { resultId: id, caseId: result.imported_case_id, created: false, duplicate: false, alreadyImported: true };
  }

  const existing = await pool.query('SELECT id FROM cases WHERE organization_id = $1 AND process_number = $2', [organizationId, result.process_number]);
  if (existing.rows.length > 0) {
    const existingId = existing.rows[0].id as string;
    await pool.query(
      `UPDATE process_discovery_results SET status = 'DUPLICATE', imported_case_id = $1, updated_at = now() WHERE id = $2`,
      [existingId, id],
    );
    void auditLog({ organizationId, userId, action: 'PROCESS_DISCOVERY_DUPLICATE', entity: 'process_discovery_result', entityId: id, after: { status: 'DUPLICATE', processNumber: result.process_number }, ip });
    return { resultId: id, caseId: existingId, created: false, duplicate: true, alreadyImported: false };
  }

  // Responsável: prioridade explícita → SOLO default → null.
  const responsibleId = opts.responsibleId ?? opts.defaultResponsibleId ?? null;

  // Valida cliente existente (read-only, antes da transação).
  if (opts.clientId) {
    const clientRes = await pool.query('SELECT id FROM clients WHERE id = $1 AND organization_id = $2', [opts.clientId, organizationId]);
    if (clientRes.rows.length === 0) throw errors.validation('Cliente inválido para esta instalação.');
  }

  const client = await pool.connect();
  let caseId = '';
  let clientId: string | null = null;
  try {
    await client.query('BEGIN');

    // Cliente: existente validado OU novo explicitamente confirmado (dentro da transação).
    if (opts.clientId) {
      clientId = opts.clientId;
    } else if (opts.newClient) {
      const created = await client.query(
        `INSERT INTO clients (organization_id, name, email, phone, cpf_cnpj, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [organizationId, opts.newClient.name, opts.newClient.email ?? null, opts.newClient.phone ?? null, opts.newClient.cpfCnpj ?? null, opts.newClient.notes ?? null],
      );
      clientId = created.rows[0].id as string;
    }

    const title = result.title || `Processo ${result.process_number}`;
    const caseRes = await client.query(
      `INSERT INTO cases (organization_id, client_id, title, process_number, court, area, responsible_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [organizationId, clientId, title, result.process_number, result.court ?? null, result.area ?? null, responsibleId],
    );
    caseId = caseRes.rows[0].id as string;

    await client.query(
      `INSERT INTO case_members (case_id, user_id, role, can_view, can_edit, can_manage)
       VALUES ($1, $2, 'ADMIN', TRUE, TRUE, TRUE) ON CONFLICT (case_id, user_id) DO NOTHING`,
      [caseId, userId],
    );

    await client.query(
      `UPDATE process_discovery_results SET status = 'IMPORTED', imported_case_id = $1, updated_at = now() WHERE id = $2`,
      [caseId, id],
    );

    await client.query('COMMIT');

    // Auditoria fora da transação (se falhar, não derruba a importação).
    if (opts.newClient) {
      void auditLog({ organizationId, userId, action: 'CLIENT_CREATED', entity: 'client', entityId: clientId, after: { name: opts.newClient.name, viaDiscovery: true }, ip });
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await addEvent({ processId: caseId, type: 'PROCESS_CREATED', title: 'Processo importado', description: `Processo ${result.process_number} importado a partir da descoberta (${result.source}).`, source: result.source, sourceReference: result.external_process_id ?? null, createdBy: userId });

  const metadata = (result.metadata ?? {}) as { movements?: Array<{ date?: string | null; description: string; sourceReference?: string | null }>; publications?: Array<{ content: string; publicationDate?: string | null; availabilityDate?: string | null; externalReference?: string | null; possibleDueDate?: string | null; notes?: string | null }> };
  const movements = metadata.movements ?? [];
  const publications = metadata.publications ?? [];

  for (const mov of movements) {
    try {
      if (mov.description && !(await existsMovement(caseId, result.source, mov.sourceReference, mov.description))) {
        await addEvent({ processId: caseId, type: 'CAPTURE_MOVEMENT', title: mov.description, description: mov.description, source: result.source, sourceReference: mov.sourceReference ?? null, createdBy: userId });
      }
    } catch {
      // nunca derruba a importação por causa de um movimento
    }
  }
  for (const pub of publications) {
    try {
      if (pub.content) {
        await createPublication(organizationId, { processId: caseId, source: result.source, availabilityDate: pub.availabilityDate ?? null, publicationDate: pub.publicationDate ?? null, content: pub.content, externalReference: pub.externalReference ?? null, possibleDueDate: pub.possibleDueDate ?? null, notes: pub.notes ?? null }, userId, ip);
      }
    } catch {
      // nunca derruba a importação por causa de uma publicação
    }
  }

  void auditLog({ organizationId, userId, action: 'PROCESS_DISCOVERY_IMPORTED', entity: 'process_discovery_result', entityId: id, after: { status: 'IMPORTED', caseId, clientId, responsibleId, processNumber: result.process_number, movements: movements.length, publications: publications.length }, ip });

  return { resultId: id, caseId, clientId, responsibleId, created: true, duplicate: false, alreadyImported: false, movements: movements.length, publications: publications.length };
}

export async function importDiscoveryBatch(organizationId: string, ids: string[], userId: string, ip?: string, opts: ImportDiscoveryResultOptions = {}) {
  const results: Array<{ resultId: string; caseId: string; created: boolean; duplicate: boolean; alreadyImported?: boolean }> = [];
  let created = 0;
  let duplicate = 0;
  for (const id of ids) {
    try {
      const r = await importDiscoveryResult(organizationId, id, userId, ip, opts);
      results.push(r);
      if (r.created) created += 1;
      if (r.duplicate) duplicate += 1;
    } catch {
      // falha em um item não bloqueia o lote
    }
  }
  return { results, created, duplicate, total: ids.length };
}

export async function getDiscoveryStatus(organizationId: string): Promise<{ providers: Array<{ source: string; mode: string; implemented: boolean; configured: boolean; enabled: boolean; label: string; capabilities: ReturnType<ProcessDiscoveryProvider['capabilities']> }> }> {
  const providers = getDiscoveryProviders();
  const items = await Promise.all(
    providers.map(async (provider) => {
      const config = await _getSourceConfig(organizationId, provider.source);
      return {
        source: provider.source,
        mode: provider.mode,
        implemented: provider.implemented,
        configured: provider.implemented && provider.isConfigured(config),
        enabled: config?.enabled === false ? false : true,
        label: provider.label,
        capabilities: provider.capabilities(),
      };
    }),
  );
  return { providers: items };
}
