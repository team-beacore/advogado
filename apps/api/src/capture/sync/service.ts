import { getPool } from '../../db/client';
import { errors } from '../../errors';
import { auditLog } from '../../audit/audit';
import { getNotificationPreferences } from '../../services/preferencesService';
import { _getSourceConfig } from '../service';
import { lookupDataJudProcess } from '../datajud/adapter';
import { parseCNJ } from '../datajud/cnj';
import type { NormalizedDataJudResult } from '../datajud/normalize';
import type { CaptureSource } from '@advogado/shared';

export type ProcessLookupFn = (processNumber: string, config: Record<string, unknown> | null) => Promise<NormalizedDataJudResult | null>;

export type SyncStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';

export interface SyncResult {
  caseId: string;
  processNumber: string | null;
  source: string;
  status: SyncStatus;
  found: number;
  inserted: number;
  duplicates: number;
  errors: number;
  movementsFound: number;
  publicationsFound: number;
  synchronizedAt: string;
  runId: string;
  errorMessage?: string | null;
}

/** Cria capture_run para a sincronização. */
async function createRun(orgId: string, caseId: string, processNumber: string, source: string, mode: string, userId: string | null) {
  const pool = getPool();
  const res = await pool.query(
    `INSERT INTO capture_runs (organization_id, adapter, source, mode, case_id, status, started_at, created_by, metadata)
     VALUES ($1, 'SYNC', $2, $3, $4, 'RUNNING', now(), $5, $6) RETURNING id`,
    [orgId, source, mode, caseId, userId, JSON.stringify({ caseId, processNumber, kind: 'SYNC' })],
  );
  return res.rows[0].id as string;
}

async function finishRun(runId: string, status: string, counters: { found: number; imported: number; duplicate: number; errors: number }, errorMessage: string | null): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE capture_runs SET
       status = $2, found_count = $3, imported_count = $4, duplicate_count = $5,
       error_count = $6, error_message = $7, created_count = $4, skipped_count = $5,
       finished_at = now()
     WHERE id = $1`,
    [runId, status, counters.found, counters.imported, counters.duplicate, counters.errors, errorMessage],
  );
}

function safeMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message;
    // Não expõe detalhes internos.
    if (msg.includes('Authorization') || msg.includes('password') || msg.includes('token')) return 'Erro de autenticação com a fonte.';
    return msg;
  }
  return 'Erro desconhecido.';
}

/**
 * Sincroniza um único processo contra sua fonte de dados.
 *
 * Fluxo: carrega o Case → identifica o tribunal → consulta a fonte →
 * compara eventos existentes → insere somente novos → notifica responsável.
 *
 * A operação é idempotente: eventuais duplicatas são prevenidas pelo índice
 * único parcial (process_id, source, source_reference) na tabela case_events.
 *
 * @param lookup — opcional, usado apenas em testes para injetar um falso provider.
 *   Em produção o padrão é lookupDataJudProcess (chamada real ao DataJud).
 */
export async function syncCase(organizationId: string, caseId: string, userId: string | null, ip?: string, lookup?: ProcessLookupFn): Promise<SyncResult> {
  const pool = getPool();

  // 1. Carrega o Case (valida organização).
  const caseRes = await pool.query(
    'SELECT c.*, o.plan_type FROM cases c JOIN organizations o ON o.id = c.organization_id WHERE c.id = $1 AND c.organization_id = $2',
    [caseId, organizationId],
  );
  if (caseRes.rows.length === 0) throw errors.notFound('Processo não encontrado.');
  const caseRow = caseRes.rows[0];
  const processNumber = caseRow.process_number as string | null;
  if (!processNumber) throw errors.validation('Processo sem número CNJ. Não é possível sincronizar.');

  const parsed = parseCNJ(processNumber);
  if (!parsed) throw errors.validation('Número CNJ inválido. Não é possível sincronizar.');

  // 2. Determina fonte (DataJud é a fonte primária de monitoramento).
  //    Futuramente poderá ser configurável por fonte por processo/instalação.
  const source: CaptureSource = 'DATAJUD';

  // 3. Resolve configuração da fonte.
  const config = await _getSourceConfig(organizationId, source);
  const runId = await createRun(organizationId, caseId, processNumber, source, 'PUBLIC', userId);

  let movementsFound = 0;
  let inserted = 0;
  let duplicates = 0;
  let errorCount = 0;
  let lastError: string | null = null;
  let status: SyncStatus = 'SUCCESS';

  try {
    // 4. Consulta DataJud via lookup (chamada HTTP real).
    void auditLog({ organizationId, userId, action: 'PROCESS_SYNC_STARTED', entity: 'case', entityId: caseId, after: { processNumber, source }, ip, metadata: { runId } });

    const lookupFn = lookup ?? lookupDataJudProcess;
    const result = await lookupFn(processNumber, config);
    void auditLog({ organizationId, userId, action: 'PROCESS_SYNC_FETCHED', entity: 'case', entityId: caseId, after: { processNumber, source, found: result ? 1 : 0, movements: result?.movements.length ?? 0 }, ip });

    // 5. Normaliza e compara.
    if (result) {
      movementsFound = result.movements.length;

      // 5a. Insere movimentações (idempotente — unique index evita duplicatas concorrentes).
      for (const mov of result.movements) {
        if (!mov.description) continue;
        const sourceRef = mov.sourceReference ?? null;
        try {
          const insertRes = await pool.query(
            `INSERT INTO case_events (process_id, type, title, description, source, source_reference, created_by)
             VALUES ($1, 'CAPTURE_MOVEMENT', $2, $3, $4, $5, $6)
             ON CONFLICT (process_id, source, source_reference) WHERE source_reference IS NOT NULL DO NOTHING
             RETURNING id`,
            [caseId, mov.description, mov.description, source, sourceRef, userId],
          );
          if (insertRes.rows.length > 0) {
            inserted += 1;
            void auditLog({ organizationId, userId, action: 'PROCESS_MOVEMENT_IMPORTED', entity: 'case_event', entityId: caseId, after: { processNumber, source, description: mov.description, sourceReference: sourceRef }, ip });
          } else {
            duplicates += 1;
          }
        } catch {
          errorCount += 1;
        }
      }

      // 5b. Publicações — DataJud não oferece; preparado para futuras fontes.
      // (Para DJEN ou outras fontes que retornam publicações, a inserção seria análoga.)
    }

    // 6. Atualiza campos de monitoramento no Case.
    await pool.query(
      `UPDATE cases SET last_synced_at = now(), monitoring_status = 'ACTIVE', last_sync_error = NULL, updated_at = now() WHERE id = $1`,
      [caseId],
    );

    status = errorCount > 0 ? (inserted > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS';
    if (status === 'FAILED' && errorCount > 0 && movementsFound === 0) {
      lastError = 'Erro ao processar movimentações do DataJud.';
    }

    await finishRun(runId, status, { found: movementsFound, imported: inserted, duplicate: duplicates, errors: errorCount }, lastError);
    void auditLog({ organizationId, userId, action: 'PROCESS_SYNC_COMPLETED', entity: 'case', entityId: caseId, after: { processNumber, source, status, found: movementsFound, inserted, duplicates, errors: errorCount }, ip, metadata: { runId } });

    // 7. Notificação: se houver novos eventos, notifica o responsável.
    if (inserted > 0) {
      await notifyResponsibleForNewEvents(organizationId, caseId, caseRow, inserted, ip);
    }
  } catch (err) {
    const msg = safeMessage(err);
    status = 'FAILED';
    lastError = msg;
    await finishRun(runId, status, { found: movementsFound, imported: inserted, duplicate: duplicates, errors: errorCount + 1 }, lastError);
    await pool.query(
      `UPDATE cases SET monitoring_status = 'ERROR', last_sync_error = $1, updated_at = now() WHERE id = $2`,
      [msg, caseId],
    );
    void auditLog({ organizationId, userId, action: 'PROCESS_SYNC_FAILED', entity: 'case', entityId: caseId, after: { processNumber, source, error: msg }, ip, metadata: { runId } });
  }

  return {
    caseId,
    processNumber,
    source,
    status,
    found: movementsFound,
    inserted,
    duplicates,
    errors: errorCount,
    movementsFound,
    publicationsFound: 0,
    synchronizedAt: new Date().toISOString(),
    runId,
    errorMessage: lastError,
  };
}

/** Lista o histórico de sincronizações de um processo (da capture_runs). */
export async function listCaseSyncRuns(organizationId: string, caseId: string, opts: { page?: number; pageSize?: number } = {}) {
  const pool = getPool();
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const res = await pool.query(
    `SELECT r.*, u.name AS user_name FROM capture_runs r
     LEFT JOIN users u ON u.id = r.created_by
     WHERE r.organization_id = $1 AND r.case_id = $2 AND r.adapter = 'SYNC'
     ORDER BY r.started_at DESC LIMIT $3 OFFSET $4`,
    [organizationId, caseId, pageSize, (page - 1) * pageSize],
  );
  const countRes = await pool.query(
    'SELECT count(*)::int AS total FROM capture_runs WHERE organization_id = $1 AND case_id = $2 AND adapter = $3',
    [organizationId, caseId, 'SYNC'],
  );
  return { items: res.rows, total: countRes.rows[0]?.total ?? 0, page, pageSize };
}
async function notifyResponsibleForNewEvents(orgId: string, caseId: string, caseRow: Record<string, unknown>, newCount: number, ip?: string): Promise<void> {
  const responsibleId = caseRow.responsible_id as string | null;
  if (!responsibleId) return;

  const pool = getPool();
  const userRes = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [responsibleId]);
  const user = userRes.rows[0];
  if (!user || !user.email) return;

  const prefs = await getNotificationPreferences(responsibleId);
  if (!prefs.emailEnabled) return;

  const processLabel = (caseRow.title as string) || (caseRow.process_number as string) || '';
  const title = `Nova movimentação — ${processLabel}`;
  const description = `Foram identificadas ${newCount} nova(s) movimentação(ões) no processo ${processLabel}.`;

  // Cria notificação interna.
  const notifRes = await pool.query(
    `INSERT INTO notifications (organization_id, process_id, user_id, type, title, description, status)
     VALUES ($1, $2, $3, 'PROCESS_MOVEMENT', $4, $5, 'PENDING') RETURNING id`,
    [orgId, caseId, responsibleId, title, description],
  );
  const notificationId = notifRes.rows[0].id as string;

  // Dispara email.
  try {
    const { dispatchNotification } = await import('../../notify/service');
    await dispatchNotification(orgId, notificationId, {
      userId: responsibleId,
      recipientEmail: user.email,
      title,
      description,
    });
    void auditLog({ organizationId: orgId, userId: responsibleId, action: 'PROCESS_NOTIFICATION_SENT', entity: 'notification', entityId: notificationId, after: { processId: caseId, type: 'PROCESS_MOVEMENT', newCount }, ip });
  } catch {
    // Email nunca deve derrubar a sincronização.
  }
}