-- 0006_organization_plan.sql
-- Adiciona o plano da organização (SOLO | OFFICE) para controle de recursos.
-- PLAN representa quais recursos a organização contratou (não é role).

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_type TEXT;
-- valor: 'SOLO' ou 'OFFICE'
