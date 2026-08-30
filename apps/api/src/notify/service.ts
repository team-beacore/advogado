import { getPool } from '../db/client';
import { getNotificationChannels } from './registry';
import type { ChannelMessage } from './types';

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
    result.push({
      channel: ch.name,
      configured: ch.isConfigured(config),
      enabled: Boolean(config?.enabled),
    });
  }
  return result;
}

export interface DispatchOptions {
  userId?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  title: string;
  description: string;
}

export async function dispatchNotification(organizationId: string, notificationId: string, opts: DispatchOptions): Promise<Array<Record<string, unknown>>> {
  const pool = getPool();
  const channels = getNotificationChannels();
  const deliveries: Array<Record<string, unknown>> = [];

  for (const ch of channels) {
    const config = await getChannelConfig(organizationId, ch.name);
    const enabled = Boolean(config?.enabled);
    const recipient = ch.name === 'EMAIL' ? opts.recipientEmail : opts.recipientPhone;
    if (!enabled || !config || !recipient) {
      continue;
    }
    const deliveryRes = await pool.query(
      `INSERT INTO notification_deliveries (organization_id, notification_id, user_id, channel, recipient, subject, body, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING') RETURNING *`,
      [organizationId, notificationId, opts.userId ?? null, ch.name, recipient, opts.title, opts.description],
    );
    const delivery = deliveryRes.rows[0];

    const message: ChannelMessage = { to: recipient, subject: opts.title, body: opts.description };
    const result = await ch.send(message, config);
    await pool.query(
      `UPDATE notification_deliveries SET status = $1, error = $2, external_reference = $3, sent_at = CASE WHEN $1 = 'SENT' THEN now() ELSE NULL END
       WHERE id = $4`,
      [result.status, result.error ?? null, result.externalReference ?? null, delivery.id],
    );
    deliveries.push({ ...delivery, status: result.status, error: result.error ?? null });
  }
  return deliveries;
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