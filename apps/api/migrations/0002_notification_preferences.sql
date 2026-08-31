-- 0002_notification_preferences.sql
-- Novos campos e tabelas para notificações:
-- 1) users.phone (telefone do usuário/advogado)
-- 2) notification_preferences (preferências de notificação do usuário)
-- 3) client_notification_preferences (preferências do cliente)

-- 1) Telefone do usuário
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- 2) Preferências de notificação do usuário
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  new_publication BOOLEAN NOT NULL DEFAULT TRUE,
  deadline_alert BOOLEAN NOT NULL DEFAULT TRUE,
  payment_alert BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_user_unique ON notification_preferences (user_id);

-- 3) Preferências de notificação do cliente
CREATE TABLE IF NOT EXISTS client_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  process_updates_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS client_notification_prefs_client_unique ON client_notification_preferences (client_id);