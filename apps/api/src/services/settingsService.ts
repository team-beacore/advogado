import { getPool } from '../db/client';
import { getEnv } from '../config';
import { getProviderInfo } from '../ai/registry';

/**
 * Relatório de Privacidade e Segurança.
 * Exibe SOMENTE informações reais da aplicação.
 * Integrações/configurações ausentes aparecem como "Não configurado".
 */
export async function getSecurityReport(organizationId: string, userId: string) {
  const pool = getPool();
  const env = getEnv();

  const [orgRes, usersRes, clientsRes, casesRes, documentsRes, leadsRes, aiCountRes, auditCountRes] = await Promise.all([
    pool.query('SELECT id, name, created_at FROM organizations WHERE id = $1', [organizationId]),
    pool.query(
      `SELECT u.id, u.name, u.email, om.role, om.created_at FROM organization_members om JOIN users u ON u.id = om.user_id WHERE om.organization_id = $1 ORDER BY om.created_at`,
      [organizationId],
    ),
    pool.query('SELECT count(*)::int AS count FROM clients WHERE organization_id = $1', [organizationId]),
    pool.query('SELECT count(*)::int AS count FROM cases WHERE organization_id = $1', [organizationId]),
    pool.query('SELECT count(*)::int AS count FROM documents WHERE organization_id = $1 AND deleted_at IS NULL', [organizationId]),
    pool.query('SELECT count(*)::int AS count FROM leads WHERE organization_id = $1', [organizationId]),
    pool.query('SELECT count(*)::int AS count FROM ai_interactions WHERE organization_id = $1', [organizationId]),
    pool.query('SELECT count(*)::int AS count FROM audit_logs WHERE organization_id = $1', [organizationId]),
  ]);

  const storageRes = await pool.query(
    'SELECT COALESCE(sum(size), 0)::bigint AS total_bytes FROM documents WHERE organization_id = $1 AND deleted_at IS NULL',
    [organizationId],
  );

  const settingsRes = await pool.query('SELECT key, value FROM settings WHERE organization_id = $1', [organizationId]);
  const settings = new Map<string, unknown>();
  for (const row of settingsRes.rows) settings.set(row.key, row.value);

  const integrations = {
    pje: settings.get('integration.pje') ?? null,
    esaj: settings.get('integration.esaj') ?? null,
    projudi: settings.get('integration.projudi') ?? null,
    payments: settings.get('integration.payments') ?? null,
    paymentsMercadopago: settings.get('integration.payments.mercadopago') ?? null,
    paymentsStripe: settings.get('integration.payments.stripe') ?? null,
    capturePje: settings.get('integration.capture.pje') ?? null,
    captureEsaj: settings.get('integration.capture.esaj') ?? null,
    captureProjudi: settings.get('integration.capture.projudi') ?? null,
  };

  const aiProvider = getProviderInfo();
  const ai = {
    configured: aiProvider.configured,
    provider: aiProvider.configured ? aiProvider.name : null,
    model: aiProvider.name === 'local-rules' ? 'local-rules' : (env.OPENAI_API_KEY ? env.OPENAI_MODEL : null),
    baseUrl: aiProvider.name === 'local-rules' ? 'local (offline)' : (env.OPENAI_API_KEY ? env.OPENAI_BASE_URL : null),
    disclaimer: 'A IA auxilia o advogado. A revisão e decisão final são humanas.',
  };

  return {
    organization: orgRes.rows[0] ?? null,
    currentUserId: userId,
    users: usersRes.rows,
    storage: {
      driver: env.STORAGE_DRIVER,
      totalBytes: Number(storageRes.rows[0]?.total_bytes ?? 0),
      documentCount: documentsRes.rows[0]?.count ?? 0,
    },
    counts: {
      clients: clientsRes.rows[0]?.count ?? 0,
      cases: casesRes.rows[0]?.count ?? 0,
      leads: leadsRes.rows[0]?.count ?? 0,
      aiInteractions: aiCountRes.rows[0]?.count ?? 0,
      auditLogs: auditCountRes.rows[0]?.count ?? 0,
    },
    ai,
    integrations,
  };
}
