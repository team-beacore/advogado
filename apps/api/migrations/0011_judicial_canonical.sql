-- 0011_judicial_canonical.sql
-- ETAPA 12A — Corrige a normalização sem quebrar a arquitetura existente.
--
-- 1) cases — campos processuais canônicos (multi-fonte: DataJud, PJe, eproc, e-SAJ, PROJUDI...)
--    - class_code / class_name: classe do processo
--    - judicial_system / judicial_system_code: sistema processual (PJe, eproc, e-SAJ, PROJUDI)
--    - degree: grau (JE, TR, JUÍZO, etc.)
--    - filing_date: data de ajuizamento
--    - source_last_updated_at: última atualização NA FONTE (não o momento da consulta)
--    - subjects: assuntos estruturados [{codigo, nome}]
--    - source_metadata: dados específicos da fonte (metadata.dataJud / metadata.pje)
-- 2) case_events — estrutura da movimentação:
--    - occurred_at: data/hora do evento NA FONTE (não created_at da nossa aplicação)
--    - event_code / event_name: código e nome da movimentação
--    - event_metadata: complementos tabelados estruturados + metadados da fonte
-- 3) process_discovery_results — campos canônicos promovidos (consistência com cases).
--
-- Não altera nenhuma coluna existente; adiciona somente. Preserva registros atuais.

-- ---------- cases ----------
ALTER TABLE cases ADD COLUMN IF NOT EXISTS class_code TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS class_name TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS judicial_system TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS judicial_system_code TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS degree TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS filing_date TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS source_last_updated_at TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS subjects JSONB;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS source_metadata JSONB;

-- Corrige semântica de area: valores que hoje carregam sistema processual (ex.: "PJe")
-- são migrados para judicial_system preservando o dado. Nada é descartado.
UPDATE cases SET judicial_system = area
WHERE area IS NOT NULL AND lower(area) IN ('pje', 'eproc', 'esaj', 'projudi', 'eproc v2');
UPDATE cases SET area = NULL
WHERE lower(area) IN ('pje', 'eproc', 'esaj', 'projudi', 'eproc v2');

CREATE INDEX IF NOT EXISTS cases_judicial_system_idx ON cases(judicial_system);
CREATE INDEX IF NOT EXISTS cases_class_name_idx ON cases(class_name);

-- ---------- case_events ----------
ALTER TABLE case_events ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;
ALTER TABLE case_events ADD COLUMN IF NOT EXISTS event_code TEXT;
ALTER TABLE case_events ADD COLUMN IF NOT EXISTS event_name TEXT;
ALTER TABLE case_events ADD COLUMN IF NOT EXISTS event_metadata JSONB;

CREATE INDEX IF NOT EXISTS case_events_occurred_at_idx ON case_events(process_id, occurred_at);

-- ---------- process_discovery_results ----------
ALTER TABLE process_discovery_results ADD COLUMN IF NOT EXISTS class_code TEXT;
ALTER TABLE process_discovery_results ADD COLUMN IF NOT EXISTS judicial_system_code TEXT;
ALTER TABLE process_discovery_results ADD COLUMN IF NOT EXISTS degree TEXT;
ALTER TABLE process_discovery_results ADD COLUMN IF NOT EXISTS filing_date TIMESTAMPTZ;
ALTER TABLE process_discovery_results ADD COLUMN IF NOT EXISTS source_last_updated_at TIMESTAMPTZ;
