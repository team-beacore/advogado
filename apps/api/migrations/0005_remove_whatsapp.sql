-- 0005_remove_whatsapp.sql
-- Remove toda referência a WhatsApp/WAHA: notificações passam a ser apenas por e-mail.

ALTER TABLE notification_preferences DROP COLUMN IF EXISTS whatsapp_enabled;
ALTER TABLE client_notification_preferences DROP COLUMN IF EXISTS whatsapp_enabled;
