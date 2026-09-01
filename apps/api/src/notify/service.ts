import { getPool } from '../db/client';
import { getNotificationChannels } from './registry';
import type { ChannelMessage } from './types';
import { getNotificationPreferences } from '../services/preferencesService';

export async function getChannelConfig(organizationId: string, channel: string): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const res = await pool.query(
    'SELECT value FROM settings WHERE organization_id = $1 AND key = $2',
    [organizationId, `integration.notify.${channel}`],
  );
  return (res.rows[0]?.value as Record<string, unknown> | null) ?? null;
}

export async function saveChannelConfig(organizationId: string, channel: string, config: Record<string, unknown>): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO settings (organization_id, key, value, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [organizationId, `integration.notify.${channel}`, JSON.stringify(config)],
  );
}

export async function getChannelStatus(organizationId: string): Promise<Array<{ channel: string; configured: boolean; enabled: boolean }>> {
  const channels = getNotificationChannels();
  const result: Array<{ channel: string; configured: boolean; enabled: boolean }> = [];
  for (const ch of channels) {
    const config = await getChannelConfig(organizationId, ch.name);
    const isConfigured = ch.isConfigured(config);
    result.push({
      channel: ch.name,
      configured: isConfigured,
      enabled: config ? Boolean(config.enabled) : isConfigured,
    });
  }
  return result;
}

export interface DispatchOptions {
  userId?: string | null;
  recipientEmail?: string | null;
  title: string;
  description: string;
}

export async function dispatchNotification(organizationId: string, notificationId: string, opts: DispatchOptions): Promise<Array<Record<string, unknown>>> {
  const pool = getPool();
  const channels = getNotificationChannels();
  const deliveries: Array<Record<string, unknown>> = [];

  for (const ch of channels) {
    const config = await getChannelConfig(organizationId, ch.name);
    const recipient = opts.recipientEmail;
    if (!recipient) continue;

    // Config por organização; quando não existe, o canal usa o SMTP global das env vars.
    const isConfigured = ch.isConfigured(config);
    const enabled = config ? Boolean(config.enabled) : isConfigured;

    const deliveryRes = await pool.query(
      `INSERT INTO notification_deliveries (organization_id, notification_id, user_id, channel, recipient, subject, body, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING') RETURNING *`,
      [organizationId, notificationId, opts.userId ?? null, ch.name, recipient, opts.title, opts.description],
    );
    const delivery = deliveryRes.rows[0];

    let result: { channel: string; status: string; error?: string | null; externalReference?: string | null };
    if (!enabled || !isConfigured) {
      result = { channel: ch.name, status: 'NOT_CONFIGURED', error: `Canal ${ch.name} não configurado.` };
    } else {
      const message: ChannelMessage = { to: recipient, subject: opts.title, body: opts.description };
      result = await ch.send(message, config ?? {});
    }
    await pool.query(
      `UPDATE notification_deliveries SET status = $1, error = $2, external_reference = $3, sent_at = CASE WHEN $1 = 'SENT' THEN now() ELSE NULL END
       WHERE id = $4`,
      [result.status, result.error ?? null, result.externalReference ?? null, delivery.id],
    );
    deliveries.push({ ...delivery, status: result.status, error: result.error ?? null });
  }
  return deliveries;
}

/** Envia notificação de acordo com as preferências do usuário. */
export async function dispatchToUserResponsible(organizationId: string, notificationId: string, processId: string, opts: { title: string; description: string }): Promise<void> {
  const pool = getPool();
  const caseRes = await pool.query(
    'SELECT c.responsible_id, c.title, c.process_number FROM cases c WHERE c.id = $1 AND c.organization_id = $2',
    [processId, organizationId],
  );
  const caseRow = caseRes.rows[0];
  const responsibleId = caseRow?.responsible_id;
  if (!responsibleId) return;
  const userRes = await pool.query('SELECT id, email FROM users WHERE id = $1', [responsibleId]);
  const user = userRes.rows[0];
  if (!user) return;

  const prefs = await getNotificationPreferences(responsibleId);
  if (!prefs.newPublication || !prefs.emailEnabled) return;

  const processLabel = caseRow.title || caseRow.process_number || '';
  const subject = `Nova intimação${processLabel ? ` — ${processLabel}` : ''}`;

  await dispatchNotification(organizationId, notificationId, {
    userId: responsibleId,
    recipientEmail: user.email ?? null,
    title: subject,
    description: opts.description,
  });
}

export async function listDeliveries(organizationId: string, opts: { page?: number; pageSize?: number }) {
  const pool = getPool();
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;
  const res = await pool.query(
    `SELECT d.*, u.name AS user_name FROM notification_deliveries d LEFT JOIN users u ON u.id = d.user_id
     WHERE d.organization_id = $1 ORDER BY d.created_at DESC LIMIT $2 OFFSET $3`,
    [organizationId, pageSize, (page - 1) * pageSize],
  );
  const countRes = await pool.query('SELECT count(*)::int AS total FROM notification_deliveries WHERE organization_id = $1', [organizationId]);
  return { items: res.rows, total: countRes.rows[0]?.total ?? 0, page, pageSize };
}

/**
 * Comunicação controlada ao cliente sobre movimentação no processo.
 * O cliente NÃO recebe o conteúdo integral da intimação — apenas um aviso genérico,
 * e somente se as preferências do cliente autorizarem.
 */
export async function notifyClientOfUpdate(organizationId: string, processId: string): Promise<void> {
  const pool = getPool();
  const caseRes = await pool.query(
    'SELECT c.client_id, c.title FROM cases c WHERE c.id = $1 AND c.organization_id = $2',
    [processId, organizationId],
  );
  const clientId = caseRes.rows[0]?.client_id;
  if (!clientId) return;
  const clientRes = await pool.query(
    'SELECT id, name, email FROM clients WHERE id = $1 AND organization_id = $2',
    [clientId, organizationId],
  );
  const client = clientRes.rows[0];
  if (!client) return;

  const { getClientNotificationPreferences } = await import('../services/preferencesService');
  const prefs = await getClientNotificationPreferences(clientId);
  if (!prefs.processUpdatesEnabled || !prefs.emailEnabled) return;

  const subject = 'Atualização do seu processo';
  const body = `Olá, ${client.name || 'cliente'}.\n\nHouve uma nova movimentação no seu processo.\nSeu advogado foi informado e está analisando a atualização.\n\nAcesse a plataforma para consultar mais informações.`;

  const notifRes = await pool.query(
    `INSERT INTO notifications (organization_id, process_id, user_id, type, title, description, status)
     VALUES ($1, $2, NULL, 'CLIENT_UPDATE', $3, $4, 'PENDING') RETURNING id`,
    [organizationId, processId, subject, body],
  );
  const notificationId = notifRes.rows[0].id as string;

  await dispatchNotification(organizationId, notificationId, {
    userId: null,
    recipientEmail: client.email ?? null,
    title: subject,
    description: body,
  });
}