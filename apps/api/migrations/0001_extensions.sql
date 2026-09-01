-- 0001_extensions.sql
-- Melhorias: extração de texto/OCR, captura de publicações, canais de notificação,
-- módulo financeiro, permissões granulares, storage S3 e IA local.

-- 1) Extração de texto dos documentos (PDF/DOCX/OCR) para alimentar a IA
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extracted_text TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extraction_method TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS documents_extraction_idx ON documents (extraction_status);

-- 2) Permissões granulares por processo (case_members já existe; ampliamos o papel com permissões de ação)
ALTER TABLE case_members ADD COLUMN IF NOT EXISTS can_view BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE case_members ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE case_members ADD COLUMN IF NOT EXISTS can_manage BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE case_members ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 3) Canais de notificação e entregas reais (e-mail)
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,           -- 'EMAIL'
  recipient TEXT,
  subject TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | SENT | FAILED | NOT_CONFIGURED
  error TEXT,
  external_reference TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_deliveries_org_idx ON notification_deliveries (organization_id, created_at);
CREATE INDEX IF NOT EXISTS notification_deliveries_status_idx ON notification_deliveries (status);

-- 4) Módulo financeiro: contratos, cobranças (invoices), parcelas, pagamentos
DO $$ BEGIN
  CREATE TYPE contract_status AS ENUM ('DRAFT', 'ACTIVE', 'FINISHED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE installment_status AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('PIX', 'CREDIT_CARD', 'BOLETO', 'TRANSFER', 'CASH', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  total_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status contract_status NOT NULL DEFAULT 'DRAFT',
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contracts_organization_idx ON contracts (organization_id);
CREATE INDEX IF NOT EXISTS contracts_client_idx ON contracts (client_id);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status invoice_status NOT NULL DEFAULT 'PENDING',
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  external_reference TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_organization_idx ON invoices (organization_id);
CREATE INDEX IF NOT EXISTS invoices_contract_idx ON invoices (contract_id);
CREATE INDEX IF NOT EXISTS invoices_status_due_idx ON invoices (organization_id, status, due_date);

CREATE TABLE IF NOT EXISTS installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  due_date TIMESTAMPTZ NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  status installment_status NOT NULL DEFAULT 'PENDING',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS installments_organization_idx ON installments (organization_id);
CREATE INDEX IF NOT EXISTS installments_invoice_idx ON installments (invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  installment_id UUID REFERENCES installments(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  amount NUMERIC(14, 2) NOT NULL,
  method payment_method NOT NULL DEFAULT 'PIX',
  status payment_status NOT NULL DEFAULT 'PENDING',
  gateway TEXT,
  external_reference TEXT,
  metadata JSONB,
  paid_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_organization_idx ON payments (organization_id);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (organization_id, status);

-- 5) Eventos de captura (registro do que foi capturado dos tribunais)
CREATE TABLE IF NOT EXISTS capture_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  adapter TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING | RUNNING | SUCCESS | FAILED | NOT_CONFIGURED
  error TEXT,
  created_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS capture_runs_organization_idx ON capture_runs (organization_id, started_at);
