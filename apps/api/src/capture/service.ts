import { getPool } from '../db/client';
import { getCaptureAdapters } from './registry';
import { createPublication } from '../services/publicationService';
import type { CapturedPublication } from './types';

export interface CaptureRunSummary {
  adapter: string;
  status: 'SUCCESS' | 'FAILED' | 'NOT_CONFIGURED';
  createdCount: number;
  skippedCount: number;
  error: string | null;
}

export interface CaptureRunResult {
  runs: CaptureRunSummary[];
  totalCreated: number;
  totalSkipped: number;
}

async function getAdapterConfig(organizationId: string, adapterName: string): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const res = await pool.query('SELECT value FROM settings WHERE organization_id = $1 AND key = $2', [organizationId, `integration.capture.${adapterName.toLowerCase()}`]);
  const value = res.rows[0]?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function createRun(organizationId: string, adapterName: string, userId: string | null) {
  const pool = getPool();
  const res = await pool.query(
    `INSERT INTO capture_runs (organization_id, adapter, status, started_at, created_by)
     VALUES ($1, $2, 'RUNNING', now(), $3) RETURNING id`,
    [organizationId, adapterName, userId],
  );
  return res.rows[0].id as string;
}

async function finishRun(runId: string, status: string, createdCount: number, skippedCount: number, error: string | null) {
  const pool = getPool();
  await pool.query(
    `UPDATE capture_runs SET status = $2, created_count = $3, skipped_count = $4, error = $5, finished_at = now() WHERE id = $1`,
    [runId, status, createdCount, skippedCount, error],
  );
}

async function findProcessByNumber(organizationId: string, processNumber: string): Promise<string | null> {
  const pool = getPool();
  const res = await pool.query(
    'SELECT id FROM cases WHERE organization_id = $1 AND process_number = $2',
    [organizationId, processNumber],
  );
  return res.rows[0]?.id ?? null;
}

async function existsPublication(organizationId: string, processId: string, externalReference: string): Promise<boolean> {
  const pool = getPool();
  const res = await pool.query(
    'SELECT id FROM legal_publications WHERE organization_id = $1 AND process_id = $2 AND external_reference = $3',
    [organizationId, processId, externalReference],
  );
  return res.rows.length > 0;
}

async function ingestPublication(organizationId: string, pub: CapturedPublication, userId: string | null, ip?: string): Promise<'created' | 'skipped'> {
  const processId = await findProcessByNumber(organizationId, pub.processNumber);
  if (!processId) return 'skipped';
  if (pub.externalReference && (await existsPublication(organizationId, processId, pub.externalReference))) return 'skipped';
  await createPublication(
    organizationId,
    {
      processId,
      source: pub.source,
      availabilityDate: pub.availabilityDate ?? null,
      publicationDate: pub.publicationDate ?? null,
      content: pub.content,
      externalReference: pub.externalReference ?? null,
      possibleDueDate: pub.possibleDueDate ?? null,
      notes: pub.notes ?? null,
    },
    userId,
    ip,
  );
  return 'created';
}

export async function runCapture(organizationId: string, adapterNames?: string[], userId?: string, ip?: string): Promise<CaptureRunResult> {
  const adapters = getCaptureAdapters();
  const selected = adapterNames && adapterNames.length > 0 ? adapters.filter((a) => adapterNames.includes(a.name)) : adapters;

  const runs: CaptureRunSummary[] = [];
  let totalCreated = 0;
  let totalSkipped = 0;

  for (const adapter of selected) {
    const runId = await createRun(organizationId, adapter.name, userId ?? null);
    let createdCount = 0;
    let skippedCount = 0;
    let status: CaptureRunSummary['status'] = 'SUCCESS';
    let error: string | null = null;

    try {
      const config = await getAdapterConfig(organizationId, adapter.name);
      if (!adapter.isConfigured(config)) {
        status = 'NOT_CONFIGURED';
        error = `Adapter ${adapter.name} não configurado.`;
      } else {
        const publications = await adapter.fetch(config!);
        for (const pub of publications) {
          const outcome = await ingestPublication(organizationId, pub, userId ?? null, ip);
          if (outcome === 'created') createdCount += 1;
          else skippedCount += 1;
        }
      }
    } catch (err) {
      status = 'FAILED';
      error = err instanceof Error ? err.message : 'Falha ao capturar publicações.';
    }

    await finishRun(runId, status, createdCount, skippedCount, error);
    runs.push({ adapter: adapter.name, status, createdCount, skippedCount, error });
    totalCreated += createdCount;
    totalSkipped += skippedCount;
  }

  return { runs, totalCreated, totalSkipped };
}

export async function getCaptureStatus(organizationId: string): Promise<{ adapters: { name: string; configured: boolean }[] }> {
  const adapters = getCaptureAdapters();
  const items = await Promise.all(
    adapters.map(async (adapter) => ({
      name: adapter.name,
      configured: adapter.isConfigured(await getAdapterConfig(organizationId, adapter.name)),
    })),
  );
  return { adapters: items };
}

export async function saveCaptureConfig(organizationId: string, adapterName: string, config: Record<string, unknown>): Promise<void> {
  const pool = getPool();
  const existing = await getAdapterConfig(organizationId, adapterName);
  // Se não veio senha nova (vazia ou placeholder), preserva a senha existente
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
    [organizationId, `integration.capture.${adapterName.toLowerCase()}`, JSON.stringify(merged)],
  );
}

export async function listCaptureConfigs(organizationId: string): Promise<Array<{
  adapter: string;
  enabled: boolean;
  configured: boolean;
  login: string | null;
  passwordSet: boolean;
  baseUrl: string | null;
}>> {
  const adapters = getCaptureAdapters();
  const items = await Promise.all(
    adapters.map(async (adapter) => {
      const config = await getAdapterConfig(organizationId, adapter.name);
      return {
        adapter: adapter.name,
        enabled: Boolean(config?.enabled),
        configured: adapter.isConfigured(config),
        login: typeof config?.login === 'string' && config.login ? (config.login as string) : null,
        passwordSet: typeof config?.password === 'string' && Boolean(config.password),
        baseUrl: typeof config?.baseUrl === 'string' && config.baseUrl ? (config.baseUrl as string) : null,
      };
    }),
  );
  return items;
}

export async function deleteCaptureConfig(organizationId: string, adapterName: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM settings WHERE organization_id = $1 AND key = $2', [organizationId, `integration.capture.${adapterName.toLowerCase()}`]);
}
