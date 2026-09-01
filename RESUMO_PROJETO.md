# Plataforma Jurídica — Resumo Completo do Projeto

> Plataforma operacional multi-tenant para advocacia solo e pequenos escritórios.
> **Nenhum mock.** Tudo que aparece na interface vem de banco de dados real, autenticação real, storage real e API real.
> Integrações externas sem configuração mostram **"Não configurado"** — nunca dados falsos.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, TypeScript, Vite 6, Tailwind 3, React Router 7 |
| Backend | Node 25, Express 4, TypeScript (ESM), tsup (build) |
| Banco | PostgreSQL (real, embarcado via `embedded-postgres` para dev/testes) |
| Validação | Zod (compartilhado entre frontend e backend via `packages/shared`) |
| Testes | Node `--test` (built-in), Supertest (testes de integração HTTP) |
| Storage | Disco local (padrão) ou S3 (`@aws-sdk/client-s3`) |
| IA | OpenAI-compatível ou local (regras determinísticas) |
| Infra CI | GitHub Actions (ubuntu, typecheck/lint/build/74 testes) |

---

## Estrutura do Monorepo (npm workspaces)

```
/
├── apps/
│   ├── api/                    # Backend Express + TypeScript
│   │   ├── src/
│   │   │   ├── ai/             # Provider interface, OpenAI, LocalAI, context, operations, registry
│   │   │   ├── auth/           # Scrypt password, sessions em banco, middleware (auth/org/role)
│   │   │   ├── audit/          # AuditLog
│   │   │   ├── capture/        # Adaptadores PJe/e-SAJ/Projudi (HTTP real), service, registry
│   │   │   ├── db/             # Pool pg, migrations, schema drizzle (documentação)
│   │   │   ├── errors.ts       # ApiError com códigos (UNAUTHORIZED, FORBIDDEN, VALIDATION, etc.)
│   │   │   ├── events/         # Timeline (case_events)
│   │   │   ├── extract/        # Extração de texto: PDF (pdfjs-dist), DOCX (mammoth), TXT, OCR (tesseract.js)
│   │   │   ├── finance/        # Contratos, invoices, installments, payments, gateways (Mercado Pago/Stripe)
│   │   │   ├── notify/         # Canais de notificação: EmailChannel (nodemailer/SMTP)
│   │   │   ├── routes/         # Rotas Express por domínio
│   │   │   ├── services/       # Lógica de negócio por domínio
│   │   │   ├── storage/        # Interface Storage, LocalStorage, S3Storage, factory
│   │   │   ├── config.ts       # Zod env schema + getEnv()
│   │   │   ├── app.ts          # createApp() — monta rotas, CORS, error handler
│   │   │   └── index.ts       # Entry point — inicia PostgreSQL embarcado + migrations
│   │   ├── migrations/         # SQL puro (0000_init.sql + 0001_extensions.sql)
│   │   ├── scripts/            # dev.cjs, test.cjs, db.cjs, migrate.cjs
│   │   └── test/               # 74 testes com supertest + PostgreSQL real
│   │
│   └── web/                    # Frontend React + Vite + Tailwind
│       ├── src/
│       │   ├── api/            # client.ts (apiGet, apiPost, apiPatch, apiPut, apiDelete, apiUpload)
│       │   ├── auth/           # AuthContext (login, logout, register, switchOrg)
│       │   ├── components/     # ui.tsx — Button, Input, Select, Modal, Card, Badge, EmptyState, etc.
│       │   ├── pages/          # Páginas por domínio
│       │   ├── App.tsx         # Rotas protegidas (login → onboarding → dash + subrotas)
│       │   ├── main.tsx        # Entry React (BrowserRouter + AuthProvider)
│       │   └── index.css       # Tailwind directives + Inter font + bg-gray-50
│       ├── tailwind.config.js  # brand color palette (#2563eb blue)
│       └── vite.config.ts      # Proxy /api → :3000, alias @advogado/shared
│
└── packages/
    └── shared/                 # Zod schemas + constantes compartilhadas
        └── src/
            ├── constants.ts    # Enums: ROLES, CASE_STATUS, TASK_STATUS/PRIORITY, PUBLICATION_STATUS, etc.
            └── schemas.ts      # Schemas de validação para todas as rotas
```

---

## Banco de Dados (PostgreSQL)

25 tabelas, todas com `organization_id` (multi-tenancy), FKs com ON DELETE adequado, índices.

### Tabelas (migração 0000_init.sql)
`users`, `organizations`, `organization_members`, `clients`, `cases`, `case_members`, `documents`, `case_events`, `legal_publications`, `tasks`, `notifications`, `ai_interactions`, `ai_approvals`, `audit_logs`, `leads`, `sessions`, `settings`, `_migrations`.

### Tabelas adicionadas (0001_extensions.sql)
`notification_deliveries`, `capture_runs`, `contracts`, `invoices`, `installments`, `payments`.

### Enums
`role`, `case_status`, `task_status`, `task_priority`, `lead_status`, `publication_status`, `notification_status`, `ai_approval_status`, `ai_operation`, `contract_status`, `invoice_status`, `installment_status`, `payment_status`, `payment_method`.

---

## API — Rotas

Base `/api`. Validação com Zod em todas as entradas. Erros com `{ code, message }`.

| Prefixo | Funções |
|---|---|
| `/api/auth` | register, login, logout, me, switch-org |
| `/api/organizations` | criar, listar, membros (ADMIN) |
| `/api/clients` | CRUD + busca + detalhe (casos/documentos) |
| `/api/processes` | CRUD + busca/filtros + detalhe agregado + events + members + permissões |
| `/api/documents` | upload (multipart), listar, download autenticado, excluir, extrair texto |
| `/api/tasks` | CRUD + summary + visões (hoje/atrasadas/próximas) |
| `/api/publications` | CRUD intimações + vínculo com processo |
| `/api/leads` | CRUD + conversão em cliente |
| `/api/notifications` | listar, marcar lida, status canais, configurar canais, deliveries |
| `/api/ai` | status, interactions, summarize, analyze-publication, draft, review |
| `/api/audit` | listar logs da organização |
| `/api/dashboard` | contadores reais + resumo financeiro |
| `/api/settings` | relatório de privacidade e segurança |
| `/api/capture` | status, config (ADMIN), run capture |
| `/api/finance` | summary, contracts, invoices, payments, charges |

---

## Frontend — Páginas e Navegação

**Rotas protegidas** (requer login + organização):

| Rota | Página | Funcionalidade |
|---|---|---|
| `/login` | Login | Formulário de login |
| `/register` | Register | Cadastro de novo usuário |
| `/onboarding` | Onboarding | Criar primeira organização |
| `/` | Dashboard | Cards de contadores, tarefas do dia, próximas, atividades recentes, resumo financeiro |
| `/processos` | Processes | Lista de processos com busca, filtro, cards com indicadores |
| `/processos/:id` | ProcessDetail | Página detalhada com 7 abas (Visão geral, Timeline, Documentos, Intimações, Tarefas, IA, Auditoria) |
| `/clientes` | Clients | Lista de clientes com busca |
| `/clientes/:id` | ClientDetail | Detalhe do cliente com processos e documentos vinculados |
| `/tarefas` | Tasks | Visões (Hoje/Atrasadas/Próximas/Concluídas) com cards de sumário |
| `/intimacoes` | Publications | Lista de intimações com filtro, botão Importar dos tribunais |
| `/documentos` | Documents | Lista com upload, download, extração de texto, status de extração |
| `/leads` | Leads | CRUD de leads + conversão em cliente |
| `/financeiro` | Finance | Resumo financeiro, contratos, cobranças com parcelas, pagamentos |
| `/configuracoes` | Settings | Relatório de segurança, status IA, configuração de captura (ADMIN), canais de notificação (ADMIN) |

**Layout**: sidebar esquerda (240px, logo + navegação), header superior (nome do usuário + papel + sair), conteúdo principal.

---

## Sistema de UI — Componentes (`components/ui.tsx`)

Componentes atômicos reutilizáveis, todos em TypeScript:

- `Button` — primário (bg-brand-600)
- `SecondaryButton` — outline (border-gray-300)
- `Input` — campo de texto com foco brand
- `Textarea` — área de texto
- `Select` — select estilizado
- `Card` — container com borda + título opcional + ação
- `Badge` — chips coloridos (green/red/yellow/blue/purple/gray)
- `EmptyState` — estado vazio com ícone + título + dica
- `ErrorAlert` — alerta de erro (ApiClientError → message)
- `Modal` — overlay + modal centralizado com fundo escuro

**Utilitários**: `formatDate`, `formatDateTime`, `formatBytes`, `statusColor`, `statusLabel`.

---

## Tema (Tailwind)

- **Paleta brand**: escala blue (#2563eb) — 50 a 900
- **Fundo**: `bg-gray-50`
- **Texto**: `text-gray-900`, corpo `text-gray-500/600/700`
- **Bordas**: `border-gray-100/200`
- **Font**: `Inter`, system-ui, sans-serif
- **Cards**: `rounded-lg border border-gray-200 bg-white shadow-sm`

---

## Fluxo de Autenticação

1. Register → cria usuário no banco
2. Login → cria sessão (token 256 bits, hash SHA-256, cookie httpOnly + sameSite lax)
3. Se não tem organização → redirect `/onboarding` (cria organização + vira ADMIN)
4. Se tem → redireciona pro Dashboard
5. `requireAuth` → lê cookie → busca sessão no banco → verifica expiração → monta `req.user`
6. `requireOrg` → verifica se `organizationId` está setado na sessão
7. `requireRole('ADMIN')` → verifica papel na organização

---

## Permissões

**Nível organização**: ADMIN / LAWYER / ASSISTANT

**Nível processo** (granular):
- `can_view` — pode ver o processo
- `can_edit` — pode editar/adicionar docs/tarefas/publicações
- `can_manage` — pode gerenciar membros

Regras:
- ADMIN da organização tem acesso total a todos os processos (manage)
- Criador do processo vira membro automaticamente com manage
- Responsável pelo processo tem edit
- Membros seguem as flags `can_view`/`can_edit`/`can_manage`

---

## IA

**Interface**: `AIProvider` — `isConfigured()`, `generate({system, user, operation})`

**Implementações**:
- `OpenAICompatibleProvider` — OpenAI e compatíveis (via `OPENAI_BASE_URL`)
- `LocalAIProvider` — offline, regras determinísticas (sempre disponível, sem API key)

**Operações**: `RESUME` (sumarizar processo), `ANALYZE_INTIMATION` (analisar intimação), `DRAFT` (rascunhar petição)

**Contexto**: `ProcessContextService` monta contexto autorizado (processo, cliente, documentos com texto extraído, intimações, tarefas, eventos).

**Governança**: cada execução → `ai_interactions` + audit log + timeline event. Revisão humana → `ai_approvals`.

**Disclaimer obrigatório**: *"A IA auxilia o advogado. A revisão e decisão final são humanas."*

---

## Módulos Implementados (8 melhorias)

### 1. Extração de texto/OCR
- PDF: `pdfjs-dist` (pdf.js oficial, mantido)
- DOCX: `mammoth`
- TXT/CSV: direto
- Imagens: `tesseract.js` (opcional via `OCR_ENABLED=true`)
- Conteúdo extraído alimenta o contexto da IA
- Endpoint: `POST /api/documents/:id/extract`
- Status visível na UI (coluna "Extraído" na lista de documentos)

### 2. Captura de publicações (PJe/e-SAJ/Projudi)
- Interface `CaptureAdapter` + 3 adapters HTTP reais
- `capture_runs` registra execuções
- Match por número do processo, dedup por `external_reference`
- Configuração via UI (ADMIN) ou `PUT /api/capture/config`
- Quando sem credenciais → "Não configurado"

### 3. Notificações por canal
- `EmailChannel` (nodemailer, SMTP real)
- `notification_deliveries` com status SENT/FAILED/NOT_CONFIGURED
- Disparo automático ao registrar intimação
- Configuração via UI (ADMIN) ou `PUT /api/notifications/channels`

### 4. Módulo financeiro
- Contratos, invoices, installments, payments
- Geração automática de parcelas
- Gateways reais: Mercado Pago + Stripe (via fetch, sem SDK)
- Página web completa: resumo, CRUD, parcelamento

### 5. Permissões granulares por processo
- Sistema de níveis: view / edit / manage
- Criador vira membro automaticamente
- Aplicado em todas as rotas de processo/documentos/tarefas/publicações/IA

### 6. Storage S3
- `S3Storage` via `@aws-sdk/client-s3`
- Factory alterna entre local e S3 por `STORAGE_DRIVER`

### 7. Provider de IA local
- `LocalAIProvider` — determinístico, offline, sempre disponível
- Ativo via `AI_PROVIDER=local`

### 8. CI
- GitHub Actions (ubuntu-latest)
- `npm ci` → typecheck → lint → build → test (74 testes)

---

## Testes

**74 testes** de integração com supertest contra PostgreSQL real:

- **Auth** (4): register, login, logout, 401
- **Clients** (5): CRUD, validação, busca, detalhe
- **Processes** (6): CRUD, unicidade, timeline, filtros
- **Documents** (6): upload, MIME, list, download, isolamento, soft delete
- **Tasks** (4): CRUD, vínculo, conclusão, sumário por visão
- **Publications** (5): CRUD, timeline, notificação, status, isolamento
- **Audit** (5): log de ações, isolamento entre orgs
- **AI** (11): não configurado, status, summarize, timeline, audit, approve/reject/edit, análise de intimação, draft
- **Isolation** (4): org A vs B, unauthenticated, sem org
- **Permissions** (6): admin vê, membro sem view, add member, sem edit, com edit, admin gerencia
- **Extração** (5): TXT, PDF, DOCX, status na lista, contexto AI
- **Local AI** (2): status, summarize
- **Capture** (3): status, run configurado, run não configurado
- **Finance** (6): contrato, invoice+parcelas, pagamento, gateway não configurado, summary, isolamento
- **Notifications** (2): status, config+disparo

---

## Segurança

- Senhas: scrypt (salt + timing-safe)
- Sessões: token 256 bits, hash SHA-256, expiração, cookie httpOnly + sameSite lax
- Autorização: toda rota passa por requireAuth → requireOrg → permissão por processo
- Isolamento: toda query filtra por `organization_id`
- Upload: limite 50MB, whitelist MIME, hash SHA-256, `X-Content-Type-Options: nosniff`
- Download: sessão obrigatória, verifica pertencimento à organização (404 se não existe, sem vazar info)
- Auditoria: registra quem/o quê/quando/IP, nunca conteúdo sensível
- CORS: restrito a `CORS_ORIGIN`
- Erros: códigos úteis (UNAUTHORIZED, FORBIDDEN, VALIDATION, AI_NOT_CONFIGURED, STORAGE_UNAVAILABLE...)

---

## Como Rodar

```bash
npm install                    # na raiz
npm run dev:api                # PostgreSQL embarcado + migrações + API :3000
npm run dev:web                # frontend :5173 (proxy /api → :3000)
npm run test -w apps/api       # 74 testes
npm run typecheck              # typecheck api + web + shared
npm run lint                   # eslint 0 warnings
npm run build                  # build api (tsup) + web (vite)
```

---

## Variáveis de Ambiente (apps/api/.env)

```
PORT=3000
DATABASE_URL=postgres://advogado:advogado@127.0.0.1:54329/advogado
SESSION_SECRET=troque-esta-chave
COOKIE_NAME=advogado_session
STORAGE_DRIVER=local              # local | s3
STORAGE_DIR=./data/storage
S3_BUCKET=                        # necessário se STORAGE_DRIVER=s3
OPENAI_API_KEY=                   # vazio → "IA não configurado"
AI_PROVIDER=openai                # openai | local
OCR_ENABLED=false                 # true → ativa tesseract.js para OCR de imagens
CORS_ORIGIN=http://localhost:5173
```

---

## Estado das Integrações Externas

| Integração | Estado atual | Próximo passo |
|---|---|---|
| IA OpenAI-compatível | ✅ Funciona | — |
| IA Local | ✅ Sempre disponível | — |
| Email (SMTP) | ✅ Funciona | Configurar SMTP via settings |
| Pagamentos (Mercado Pago) | Arquitetura pronta | Inserir accessToken via settings |
| Pagamentos (Stripe) | Arquitetura pronta | Inserir secretKey via settings |
| Captura PJe | Arquitetura + config prontas | Adaptar fluxo de login específico do tribunal |
| Captura e-SAJ | Arquitetura + config prontas | Adaptar fluxo de login específico do tribunal |
| Captura Projudi | Arquitetura + config prontas | Adaptar fluxo de login específico do tribunal |

---

## Observações Técnicas

- **PostgreSQL embarcado**: ligado ao processo pai. Em produção, use um PostgreSQL externo via `DATABASE_URL`.
- **pdf-parse** foi substituído por `pdfjs-dist` porque `pdf-parse` entrava em "debug mode" ao ser importado como ESM, ignorando o buffer e tentando ler um arquivo de teste. `pdfjs-dist` é a biblioteca oficial da Mozilla, mantida.
- **Testes de tasks** usam datas flexíveis ao horário local (GMT-3) — o teste de sumário foi corrigido para ser determinístico independente da hora do dia.
- **Porta 54329**: o PostgreSQL embarcado usa essa porta. Múltiplas execuções do script de teste podem deixar processos órfãos — o `test.cjs` agora mata PostgreSQLs existentes antes de subir.