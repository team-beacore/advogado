-- 0003_roles_permissions_portal.sql
-- Adiciona FINANCE ao enum de role, campo is_super_admin, client portal tables

-- 1) FINANCE no enum de role (organization_members e case_members)
DO $$ BEGIN
  ALTER TYPE role ADD VALUE IF NOT EXISTS 'FINANCE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) SUPER ADMIN flag para usuários da plataforma (não vinculados a organização)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) Portal do cliente — identidade de acesso vinculada ao CLIENT existente
CREATE TABLE IF NOT EXISTS client_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'INVITED',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS client_users_client_unique ON client_users (client_id);
CREATE UNIQUE INDEX IF NOT EXISTS client_users_email_unique ON client_users (email);

-- 4) Compartilhamento explícito de processo com cliente (portal)
CREATE TABLE IF NOT EXISTS client_case_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  can_view_documents BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS client_case_access_unique ON client_case_access (client_id, case_id);

-- 5) Sessões do portal do cliente
CREATE TABLE IF NOT EXISTS client_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS client_sessions_token_hash_unique ON client_sessions (token_hash);