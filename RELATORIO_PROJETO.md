# RELATÓRIO GERAL DO PROJETO — Plataforma Jurídica (advogado)

**Versão:** 0.1.0 · **Última atualização do relatório:** 30/08/2026
**Repositório:** `D:\GitHub\advogado\advogado` · **Branch:** `main`

---

## 1. Visão Geral

Sistema de gestão jurídica (backoffice para advocacia) com backend Express/TypeScript, frontend React/Vite e banco PostgreSQL. Suporta dois modelos de uso no mesmo código: **advogado solo** e **escritório com equipe**. Cada instalação representa uma organização isolada (single-tenant por VPS), com isolamento total por `organization_id`.

Módulos entregues: processos, clientes, intimações (publicações), documentos, tarefas/prazos, leads, financeiro, IA contextual, notificações (e-mail via SMTP), portal do cliente, auditoria, captura de publicações, extração de texto/OCR.

---

## 2. Estrutura do Monorepo

```
advogado/
├── apps/
│   ├── api/                     # Backend Express + TypeScript (ESM)
│   │   ├── src/
│   │   │   ├── ai/              # Provider interface, OpenAI, LocalAI, contexto, operações
│   │   │   ├── audit/           # Auditoria (audit_logs)
│   │   │   ├── auth/            # middleware, password (scrypt), session
│   │   │   ├── capture/         # Adapters PJe/e-SAJ/Projudi
│   │   │   ├── db/              # Pool pg, migrate, schema (drizzle), Postgres embarcado
│   │   │   ├── events/          # Timeline (case_events)
│   │   │   ├── extract/         # PDF (pdfjs), DOCX (mammoth), TXT, OCR (tesseract)
│   │   │   ├── finance/         # Contratos, invoices, parcelas, pagamentos, gateways
│   │   │   ├── notify/          # EmailChannel (SMTP), registry, service
│   │   │   ├── routes/          # 17 arquivos de rotas
│   │   │   ├── services/        # 13 services de domínio
│   │   │   ├── storage/         # LocalStorage / S3Storage
│   │   │   ├── config.ts        # Zod env schema
│   │   │   ├── app.ts           # createApp()
│   │   │   └── index.ts         # Bootstrap + migrations
│   │   ├── migrations/          # 4 migrations SQL
│   │   ├── scripts/             # dev, test, db, migrate, reset, seed, verify
│   │   └── test/                # 19 arquivos (~112 testes)
│   └── web/                     # Frontend React 19 + Vite 6 + Tailwind 3
│       └── src/                 # api client, auth, components, pages (16), App.tsx
└── packages/
    └── shared/                  # Zod schemas + constantes (roles, permissions)
```

---

## 3. Dependências Principais

| Área | Tecnologia |
|---|---|
| Backend | Express 4, drizzle-orm, pg, zod, nodemailer, multer, pdfjs-dist, mammoth, tesseract.js, @aws-sdk/client-s3 |
| Frontend | React 19, react-router-dom 7, Vite 6, Tailwind 3 |
| Dev/Infra | embedded-postgres, tsup, tsx, supertest, node:test |
| CI | GitHub Actions (typecheck → lint → build → test) |

---

## 4. Modelo de Dados

### 4.1 Enums PostgreSQL
`role` (ADMIN/LAWYER/ASSISTANT/FINANCE), `case_status`, `task_status`, `task_priority`, `lead_status`, `publication_status`, `notification_status`, `ai_operation`, `ai_approval_status`, `contract_status`, `invoice_status`, `installment_status`, `payment_status`, `payment_method`.

### 4.2 Tabelas (25)
- **Core (0000):** users, organizations, organization_members, clients, cases, case_members, documents, case_events, legal_publications, tasks, notifications, ai_interactions, ai_approvals, audit_logs, leads, sessions, settings
- **Extensões (0001):** notification_deliveries, contracts, invoices, installments, payments, capture_runs + colunas de extração em documents + permissões em case_members
- **Preferências (0002):** notification_preferences, client_notification_preferences + `users.phone`
- **Portal (0003):** client_users, client_case_access, client_sessions + `users.is_super_admin` + role FINANCE

### 4.3 Relações-chave
- `organizations` 1:N → membros, clientes, processos, documentos, intimações, tarefas, leads, notificações, settings
- `clients` 1:N → `cases`; `clients` 1:1 → `client_users` (portal) e `client_notification_preferences`
- `cases` 1:N → case_members, events, documents, publications, tasks
- `ai_interactions` 1:N → ai_approvals

### 4.4 Multi-tenancy
Toda tabela de dados possui `organization_id` com FK. Índice parcial garante unicidade de número processual por organização. Isolamento validado por testes.

---

## 5. Roles e Permissões

### 5.1 Roles
| Role | Escopo |
|---|---|
| `SUPER_ADMIN` | Plataforma/implantador — criado via env, fora da organização |
| `ADMIN` | Administra a organização (equipe, configurações, integrações) |
| `LAWYER` | Operação jurídica completa |
| `ASSISTANT` | Cadastro de clientes/processos/intimações, documentos, tarefas |
| `FINANCE` | Apenas billing/payments |

### 5.2 Permissões (~28)
`org.manage`, `team.manage`, `settings.manage`, `notifications.manage`, `capture.manage`, `clients.*`, `processes.*`, `publications.*`, `documents.*`, `tasks.*`, `ai.use`, `leads.*`, `billing.*`, `payments.*`, `audit.read`, `client_portal.manage`.

Mapa `ROLE_PERMISSIONS` em `packages/shared/src/constants.ts`.

### 5.3 Permissões por processo (case_members)
`can_view` / `can_edit` / `can_manage`. ADMIN da organização **não** recebe acesso jurídico automático — deve ser responsável ou membro do processo (ROLE + PERMISSION + SCOPE).

### 5.4 Middlewares
`requireAuth`, `requireOrg`, `requireRole`, `requirePermission`, `requireSuperAdmin`, `getOrgId`.

---

## 6. Autenticação

- **Senha:** scrypt (salt 16B, N=16384, r=8, keylen=64), verificação timing-safe
- **Sessão:** token 256 bits, hash SHA-256 no banco, cookie httpOnly + sameSite lax, TTL configurável (default 30 dias)
- **Fluxo:** register → login → auto-select primeira org → logout (destrói sessão)

---

## 7. Fluxo de Notificações

- **Canais:** EmailChannel (nodemailer/SMTP)
- **Fluxo:** intimação → processo → **responsável** (`responsible_id`) → preferências → canais habilitados → `notification_deliveries` (SENT/FAILED/NOT_CONFIGURED)
- **Regra central:** quem registra a intimação NÃO é o destinatário; o responsável pelo processo é.
- **Cliente:** comunicação genérica/controlada (nunca íntegra da intimação), condicionada a `client_notification_preferences`.
- **Config:** SMTP via env vars ou settings por organização.

---

## 8. IA

- **Providers:** OpenAICompatibleProvider (gpt-4o-mini) e LocalAIProvider (offline, determinístico)
- **Contexto:** construído por processo (documentos, intimações, tarefas, eventos) — nunca chatbot genérico
- **Operações:** RESUME (resumo), ANALYZE_INTIMATION (análise), DRAFT (rascunho)
- **Governança:** interação + aprovação humana + auditoria + disclaimer obrigatório

---

## 9. Portal do Cliente

- **Login próprio** (`/api/portal/*`, cookie separado), vinculado ao CLIENT existente (sem duplicar cadastro)
- **Compartilhamento explícito** por processo (`client_case_access`)
- **Frontend:** PortalLogin, PortalDashboard, PortalProcessDetail

---

## 10. Frontend — Rotas

| Rota | Página |
|---|---|
| `/login`, `/register`, `/onboarding` | Login, Register, Onboarding |
| `/` | Dashboard |
| `/processos`, `/processos/:id` | Processes, ProcessDetail |
| `/clientes`, `/clientes/:id` | Clients, ClientDetail |
| `/tarefas`, `/intimacoes`, `/documentos` | Tasks, Publications, Documents |
| `/leads`, `/financeiro`, `/configuracoes` | Leads, Finance, Settings |
| `/equipe` | Team (somente `team.manage`) |
| `/portal/login`, `/portal`, `/portal/processos/:id` | Portal do cliente |

Menu lateral filtra itens por permissão do usuário.

---

## 11. Testes

- **~112 testes** em **19 arquivos**, todos passando
- Framework: `node:test` + Supertest + PostgreSQL real (embarcado)
- Cobertura: auth, clients, processes, documents, tasks, publications, audit, ai, isolation, permissions, extraction, capture, finance, notifications, emailChannel, notificationRecipient, userProfile, architecture (20 cenários)
- `npm test` na pasta `apps/api` roda tudo com banco de teste isolado

---

## 12. Status Atual

| Item | Status |
|---|---|
| Migrations | 4 aplicadas (0000–0003) |
| Build API | ✅ (tsup) |
| Build Web | ✅ (Vite) |
| Testes | ✅ 112/112 |
| Typecheck | ✅ API e Web |
| Lint | ✅ API e Web |
| Banco de dados | **Zerado** (limpo para novo uso) |

### 12.1 Integrações configuráveis
OpenAI / IA local · SMTP (e-mail) · Captura PJe/e-SAJ/Projudi · Mercado Pago/Stripe · Storage S3 · OCR (Tesseract)

---

## 13. Como rodar

```bash
# Banco (Postgres embarcado) + migrations
npm run db:migrate          # em apps/api

# Seeds de desenvolvimento (senha padrão: 12345678)
node scripts/seed.cjs solo          # João Silva Advocacia
node scripts/seed.cjs escritorio    # Silva & Associados

# Testes automatizados
npm test                    # em apps/api

# Aplicação
npm run dev                 # em apps/api (porta 3000)
npm run dev                 # em apps/web (porta 5173)
```

Acesse `http://localhost:5173`.
