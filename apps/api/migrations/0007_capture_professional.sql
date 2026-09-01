-- 0007_capture_professional.sql
-- Amplia capture_runs para a camada profissional de captura:
-- fonte, modo, contadores (encontrados/importados/duplicados/erros), mensagem de erro e metadados técnicos.
-- Preserva colunas existentes (adapter, created_count, skipped_count) para compatibilidade.

ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS mode TEXT;
ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS found_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS imported_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS duplicate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS error_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS metadata JSONB;
