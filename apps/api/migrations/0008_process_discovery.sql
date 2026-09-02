-- 0008_process_discovery.sql
-- Descoberta automática de processos:
-- 1) professional_identities — identidade profissional do advogado (OAB/UF) usada para consultar fontes.
-- 2) process_discovery_results — resultados de descoberta antes de revisão/importação.
-- Nenhuma tabela existente é alterada ou removida. A organização segue como dona da instalação (sem multi-tenancy).

CREATE TABLE IF NOT EXISTS professional_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  professional_name TEXT NOT NULL,
  oab_number TEXT NOT NULL,
  oab_state TEXT NOT NULL,
  identifiers JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS professional_identities_org_user_unique ON professional_identities(organization_id, user_id);
CREATE INDEX IF NOT EXISTS professional_identities_org_idx ON professional_identities(organization_id);

CREATE TABLE IF NOT EXISTS process_discovery_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  professional_identity_id UUID REFERENCES professional_identities(id) ON DELETE SET NULL,
  run_id UUID REFERENCES capture_runs(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  process_number TEXT NOT NULL,
  court TEXT,
  court_code TEXT,
  judicial_system TEXT,
  external_process_id TEXT,
  title TEXT,
  area TEXT,
  class TEXT,
  subjects JSONB,
  last_movement TEXT,
  last_movement_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  confidence NUMERIC,
  metadata JSONB,
  imported_case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS process_discovery_results_org_status_idx ON process_discovery_results(organization_id, status);
CREATE INDEX IF NOT EXISTS process_discovery_results_org_number_idx ON process_discovery_results(organization_id, process_number);
CREATE INDEX IF NOT EXISTS process_discovery_results_run_idx ON process_discovery_results(run_id);
