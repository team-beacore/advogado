-- 0004_installation_wizard.sql
-- Tabela para persistir o estado do wizard de implantação
CREATE TABLE IF NOT EXISTS installation_wizard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  current_step INTEGER NOT NULL DEFAULT 0,
  steps_status JSONB NOT NULL DEFAULT '[]',
  wizard_data JSONB,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);