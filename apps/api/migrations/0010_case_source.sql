-- 0010_case_source.sql
-- Adiciona coluna source em cases para permitir que cada processo
-- especifique qual fonte judicial deve ser usada para sincronização.
-- DEFAULT 'DATAJUD' mantém compatibilidade com processos existentes.

ALTER TABLE cases ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'DATAJUD';
CREATE INDEX IF NOT EXISTS cases_source_idx ON cases(source);