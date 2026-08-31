import { getPool } from '../db/client';
import { auditLog } from '../audit/audit';

export interface UserNotificationPrefs {
  emailEnabled: boolean;
  newPublication: boolean;
  deadlineAlert: boolean;
  paymentAlert: boolean;
}

const DEFAULT_PREFS: UserNotificationPrefs = {
  emailEnabled: true,
  newPublication: true,
  deadlineAlert: true,
  paymentAlert: false,
};

export async function getNotificationPreferences(userId: string): Promise<UserNotificationPrefs> {
  const pool = getPool();
  const res = await pool.query('SELECT * FROM notification_preferences WHERE user_id = $1', [userId]);
  const row = res.rows[0];
  if (!row) return { ...DEFAULT_PREFS };
  return {
    emailEnabled: row.email_enabled,
    newPublication: row.new_publication,
    deadlineAlert: row.deadline_alert,
    paymentAlert: row.payment_alert,
  };
}

export async function saveNotificationPreferences(userId: string, input: Partial<UserNotificationPrefs>, actorId: string, ip?: string): Promise<UserNotificationPrefs> {
  const pool = getPool();
  const current = await getNotificationPreferences(userId);
  const merged = { ...current, ...input };
  const res = await pool.query(
    `INSERT INTO notification_preferences (user_id, email_enabled, new_publication, deadline_alert, payment_alert, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET
       email_enabled = EXCLUDED.email_enabled,
       new_publication = EXCLUDED.new_publication,
       deadline_alert = EXCLUDED.deadline_alert,
       payment_alert = EXCLUDED.payment_alert,
       updated_at = now()
     RETURNING *`,
    [userId, merged.emailEnabled, merged.newPublication, merged.deadlineAlert, merged.paymentAlert],
  );
  const row = res.rows[0];
  void auditLog({
    organizationId: null,
    userId: actorId,
    action: 'NOTIFICATION_PREFERENCES_UPDATED',
    entity: 'notification_preference',
    entityId: row.id,
    after: { userId, ...merged },
    ip,
  });
  return merged;
}

export interface ClientNotificationPrefs {
  emailEnabled: boolean;
  processUpdatesEnabled: boolean;
}

const DEFAULT_CLIENT_PREFS: ClientNotificationPrefs = {
  emailEnabled: false,
  processUpdatesEnabled: false,
};

export async function getClientNotificationPreferences(clientId: string): Promise<ClientNotificationPrefs> {
  const pool = getPool();
  const res = await pool.query('SELECT * FROM client_notification_preferences WHERE client_id = $1', [clientId]);
  const row = res.rows[0];
  if (!row) return { ...DEFAULT_CLIENT_PREFS };
  return {
    emailEnabled: row.email_enabled,
    processUpdatesEnabled: row.process_updates_enabled,
  };
}

export async function saveClientNotificationPreferences(clientId: string, input: Partial<ClientNotificationPrefs>, actorId: string, organizationId: string, ip?: string): Promise<ClientNotificationPrefs> {
  const pool = getPool();
  const current = await getClientNotificationPreferences(clientId);
  const merged = { ...current, ...input };
  const res = await pool.query(
    `INSERT INTO client_notification_preferences (client_id, email_enabled, process_updates_enabled, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (client_id) DO UPDATE SET
       email_enabled = EXCLUDED.email_enabled,
       process_updates_enabled = EXCLUDED.process_updates_enabled,
       updated_at = now()
     RETURNING *`,
    [clientId, merged.emailEnabled, merged.processUpdatesEnabled],
  );
  const row = res.rows[0];
  void auditLog({
    organizationId,
    userId: actorId,
    action: 'CLIENT_NOTIFICATION_PREFERENCES_UPDATED',
    entity: 'client_notification_preference',
    entityId: row.id,
    after: { clientId, ...merged },
    ip,
  });
  return merged;
}