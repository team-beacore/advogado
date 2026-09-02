-- 0009_sync_monitoring.sql
-- Monitoramento e sincronização de processos:
-- 1) cases — campos de monitoramento (última sincronização, status, erro)
-- 2) capture_runs — associação opcional com o case sincronizado
-- 3) case_events — índice único para evitar duplicação concorrente

ALTER TABLE cases ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS monitoring_status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE cases ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES cases(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS capture_runs_case_idx ON capture_runs(case_id);

-- Índice único parcial para idempotência de movimentações (sourceReference como identidade principal).
-- Apenas válido quando source_reference está presente (fontes que fornecem referência externa).
CREATE UNIQUE INDEX IF NOT EXISTS case_events_source_ref_unique
  ON case_events(process_id, source, source_reference)
  WHERE source_reference IS NOT NULL;