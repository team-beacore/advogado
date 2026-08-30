# Núcleo Funcional de Plataforma Jurídica

Plataforma operacional multi-tenant para advocacia solo e pequenos escritórios: **processos como centro da operação**, documentos reais, intimações, tarefas/prazos, IA contextual com supervisão humana, auditoria e segurança.

**Nenhum mock.** Tudo que aparece na interface vem de banco de dados real, autenticação real, storage real e API real. Quando uma integração externa ainda não existe, a interface mostra **"Não configurado"** — nunca dados falsos.

---

## 1. O que foi realmente implementado

### Funcional de ponta a ponta (testado)

| Fluxo | Status |
|---|---|
| Criar conta (registro) + login/logout + sessão real | ✅ |
| Criar organização (multi-tenant) | ✅ |
| Papéis ADMIN / LAWYER / ASSISTANT | ✅ |
| Clientes: criar, editar, listar, pesquisar, detalhe com processos/documentos | ✅ |
| Processos: criar, editar, listar, filtrar, ordenar, página detalhada | ✅ |
| Página do processo como centro: resumo, timeline, documentos, intimações, tarefas, IA, auditoria | ✅ |
| Documentos: upload real, listagem, download autenticado, exclusão (soft delete), hash SHA-256, validação de MIME/tamanho | ✅ |
| Timeline: todo evento importante vira `case_event` no banco | ✅ |
| Intimações (`legal_publications`): cadastro real, vínculo ao processo, timeline, notificação, status | ✅ |
| Tarefas e prazos: criar, vincular processo, prioridade, status, visões (hoje/atrasadas/próximas/concluídas) | ✅ |
| IA contextual: `ProcessContextService` monta contexto autorizado; operações RESUME / ANALYZE_INTIMATION / DRAFT | ✅ |
| Governança de IA: toda execução gera `ai_interaction` + audit log; aprovar/editar/rejeitar gera `ai_approval` + timeline | ✅ |
| IA não configurada → resposta clara "Serviço de IA não configurado" (503 `AI_NOT_CONFIGURED`), sem fingir resposta | ✅ |
| Leads: criação manual real, conversão real em cliente preservando vínculo | ✅ |
| Auditoria: logs reais de quem/o quê/quando/entidade/before/after/IP | ✅ |
| Dashboard: só números reais do banco | ✅ |
| Privacidade e Segurança: relatório real (membros, storage, dados, IA, integrações) | ✅ |
| Isolamento entre organizações: testado em todos os módulos | ✅ |

### Estrutura do repositório

```
apps/
  api/                  Node + Express + TypeScript
    migrations/          SQL real (schema, índices, constraints)
    scripts/            dev.cjs, db.cjs, test.cjs, migrate.cjs (PostgreSQL embarcado)
    src/
      auth/             scrypt password, sessões em banco, middleware (auth/org/role)
      ai/               AIProvider interface, OpenAI-compatible, ProcessContextService, operations, registry
      audit/            auditLog
      db/               client (pg Pool), migrate, schema (drizzle)
      events/           timeline
      services/         org, client, case, document, task, publication, lead, notification, ai, dashboard, settings
      routes/           API por domínio
      storage/          Storage interface + LocalStorage
  web/                  React + Vite + TypeScript + Tailwind + React Router
    src/pages/          Login, Register, Onboarding, Dashboard, Processes, ProcessDetail, Clients, ClientDetail, Tasks, Publications, Documents, Leads, Settings
packages/
  shared/               Zod schemas + constantes compartilhadas (API e frontend)
```

---

## 2. Estrutura do banco de dados (PostgreSQL)

Migração real em `apps/api/migrations/0000_init.sql` (sem seed de dados). Tabelas:

`users`, `organizations`, `organization_members`, `clients`, `cases`, `case_members`, `documents`, `case_events`, `legal_publications`, `tasks`, `notifications`, `ai_interactions`, `ai_approvals`, `audit_logs`, `leads`, `sessions`, `settings`, `_migrations`.

- **Multi-tenancy**: toda tabela de dados tem `organization_id` com FK. Todo service filtra por `organization_id`. O número do processo é único por organização (índice parcial `cases_process_number_unique_per_org`).
- **Integridade**: FKs com `ON DELETE` adequado, enums para status/papéis/prioridades, timestamps `created_at`/`updated_at`, soft delete em `documents` (`deleted_at`).
- **Índices**: organização, processo, status, datas de vencimento, email do usuário, etc.

---

## 3. Estrutura da API

Base `/api`. Validação com Zod no backend em todas as entradas. Erros com `{ code, message }` (ex.: `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION`, `AI_NOT_CONFIGURED`, `STORAGE_UNAVAILABLE`).

| Rota | Funções |
|---|---|
| `/api/auth` | register, login, logout, me, switch-org |
| `/api/organizations` | criar, listar, membros (ADMIN) |
| `/api/clients` | CRUD + busca + detalhe (casos/documentos) |
| `/api/processes` | CRUD + busca/filtros + detalhe agregado + events + members |
| `/api/documents` | upload (multipart), listar, download autenticado, excluir |
| `/api/tasks` | CRUD + summary + visões |
| `/api/publications` | CRUD intimações + vínculo com processo |
| `/api/leads` | CRUD + conversão em cliente |
| `/api/notifications` | listar + marcar lida |
| `/api/ai` | status, interactions, summarize, analyze-publication, draft, review |
| `/api/audit` | listar logs por organização |
| `/api/dashboard` | contadores reais |
| `/api/settings` | relatório de privacidade e segurança |

---

## 4. Estrutura da IA

- **`AIProvider`** (interface): `isConfigured()` + `generate({system, user, operation})`. Implementação **OpenAI-compatible** (funciona com OpenAI e endpoints compatíveis via `OPENAI_BASE_URL`). Registry permite trocar/sobretest.
- **`ProcessContextService`**: monta contexto autorizado (processo, cliente, responsável, membros, eventos, documentos, intimações, tarefas) **somente dentro da organização**.
- **Operações**: `summarizeProcess`, `analyzeIntimation`, `suggestDraft`. Prompt de sistema deixa explícito: *"A IA auxilia o advogado. A revisão e decisão final são humanas."* e proíbe declarar prazos como definitivos sem verificação humana.
- **Governança**: cada execução insere `ai_interactions` + audit log `AI_EXECUTED` + evento de timeline `AI_EXECUTED`. Revisão (APPROVED/EDITED/REJECTED) insere `ai_approvals` + audit `AI_REVIEWED` + evento `AI_REVIEWED`. Para EDITED, `editedOutput` é obrigatório.
- **Sem API key**: endpoints retornam 503 `AI_NOT_CONFIGURED` ("Serviço de IA não configurado"). Nenhuma resposta inventada.

---

## 5. Medidas de segurança implementadas

- Senhas com **scrypt** (salted, timing-safe).
- **Sessões reais em banco** com token aleatório de 256 bits, hash SHA-256, expiração e cookie `httpOnly` + `sameSite=lax`.
- **Autorização no backend** em toda rota (`requireAuth` → `requireOrg` → `requireRole`).
- **Isolamento multi-tenant** validado por `organization_id` em todos os services (testado).
- Upload: limites de tamanho (50MB), whitelist de MIME types, hash SHA-256 do arquivo, `X-Content-Type-Options: nosniff` no download.
- Download de documento exige sessão e pertencimento à organização; acesso indevido → 404 (não expõe existência).
- Auditoria registra quem/o quê/quando/IP; **nunca** conteúdo sensível ou secrets.
- Nenhuma secret no frontend; variáveis lidas apenas no backend via `.env`.
- Erros mapeados em códigos úteis (sem "Algo deu errado" genérico quando a causa é conhecida).

> Nota: não se afirma conformidade LGPD plena. Implementaram-se mecanismos técnicos que *facilitam* conformidade e governança (auditoria, exclusão, isolamento), mas a análise jurídica de conformidade deve ser feita por profissional.

---

## 6. Testes executados

50 testes, todos passando (`npm test`), rodando contra **PostgreSQL real**:

- autenticação (register, login, logout, 401 sem cookie)
- isolamento entre organizações (clientes, processos, documentos, audit, intimações)
- criação/edição/busca de clientes
- criação de processos + unicidade do número por organização + timeline
- upload/validação MIME/download/exclusão de documentos + acesso indevido
- tarefas (criação, conclusão, summary)
- intimações (registro, timeline, notificação, processamento)
- auditoria (registro de ações + não vazamento entre orgs)
- IA (não configurada, execução, timeline, audit, aprovação/rejeição/edição, análise de intimação, rascunho)

Também executados: `typecheck`, `lint` (0 avisos), `build` em API e Web.

---

## 7. Integrações NÃO conectadas (arquitetura pronta, sem dados falsos)

| Integração | Estado |
|---|---|
| WhatsApp | Não configurado. Domínio `leads` + campo `source` prontos |
| Captura de publicações (PJe/e-SAJ/Projudi) | Não configurado. Adapters previstos; `legal_publications` aceita `external_reference` |
| PJe / e-SAJ / Projudi | Não configurado |
| Cobrança / boletos | Não configurado. Sem boleto fake |
| OCR / extração de texto de PDF/DOCX | Arquitetura preparada; documentos no contexto de IA mostram "conteúdo textual não extraído" |
| Pagamentos | Não configurado |

Na tela **Configurações → Privacidade e Segurança**, cada integração aparece como **"Não configurado"**.

---

## 8. Variáveis de ambiente necessárias

Copie `apps/api/.env` (já existe um com defaults de desenvolvimento):

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://advogado:advogado@127.0.0.1:54329/advogado
SESSION_SECRET=troque-esta-chave-em-producao-pelo-menos-32-caracteres
COOKIE_NAME=advogado_session
SESSION_TTL_DAYS=30
STORAGE_DRIVER=local
STORAGE_DIR=./data/storage
CORS_ORIGIN=http://localhost:5173
# IA (deixe OPENAI_API_KEY vazio para exibir "Serviço de IA não configurado")
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

> Em produção: gere um `SESSION_SECRET` forte, use `DATABASE_URL` externo e mantenha `OPENAI_API_KEY` no ambiente do servidor (nunca no frontend).

---

## 9. Como executar localmente

Pré-requisitos: **Node.js 20+** e npm. PostgreSQL é gerenciado automaticamente via binários embarcados reais (PostgreSQL 18.4) — não requer instalação/admin.

```bash
npm install                    # na raiz do repositório

# API (inicia PostgreSQL embarcado real + aplica migrações + sobe em :3000)
npm run dev:api                # ou: cd apps/api && npm run dev

# Frontend (em :5173, com proxy para /api)
npm run dev:web                # ou: cd apps/web && npm run dev
```

Abra http://localhost:5173, crie uma conta, crie a organização e comece.

Comandos úteis:

```bash
npm test -w apps/api           # 50 testes contra PostgreSQL real
npm run typecheck              # typecheck api + web + shared
npm run lint                   # eslint 0 avisos
npm run build                  # build api (tsup) + web (vite)
```

Para usar a IA: defina `OPENAI_API_KEY` em `apps/api/.env` e reinicie a API.

---

## 10. Riscos técnicos encontrados

1. **PostgreSQL embarcado é ligado ao processo pai.** Os scripts `dev.cjs`/`test.cjs` iniciam o servidor de banco e o mantêm vivo junto com a API. Se a API for derrubada com força, o banco também é. Para produção, use um PostgreSQL externo via `DATABASE_URL`. (Documentado em `scripts/db.cjs`.)
2. **tsx não carrega `embedded-postgres` corretamente** (interop CJS/ESM). Contornado usando scripts `.cjs` com Node puro para gerenciar o banco. O código da aplicação em si não usa esse pacote.
3. **Extração de texto de documentos (OCR/PDF) ainda não existe.** A IA vê apenas metadados dos documentos, com indicação explícita de que o conteúdo textual não foi extraído. Nenhum conteúdo foi inventado.
4. **Cookie `secure: false` em desenvolvimento** (necessário em HTTP local). Em produção com HTTPS, ativar `secure: true` no cookie.
5. **CORS em desenvolvimento** permite `http://localhost:5173`. Em produção, restrinja `CORS_ORIGIN`.
6. **Codificação Windows (WIN1252)** ao criar bancos no initdb: texto acentuado funciona, mas o charset do cluster usa o locale do SO. Para produção, configurar UTF-8 explicitamente.
7. **`SHELL`/escapamento no Windows** nos scripts de spawn (aviso DEP0190 do Node). Sem impacto funcional nos testes.

---

## 11. Próximas etapas recomendadas

1. **Extração de texto de documentos** (PDF/DOCX/imagem+OCR) e indexação; passar conteúdo real para o contexto da IA.
2. **Adapters de captura de publicações** (PJe/e-SAJ/Projudi) para inserir intimações automaticamente; hoje o cadastro é manual (real).
3. **Notificações por canal** (email/WhatsApp) a partir de intimações e prazos reais.
4. **Módulo financeiro**: contratos, cobranças, parcelas, pagamentos — preparar esquema sem gateway ainda.
5. **Permissões granulares** por processo (`case_members`) e ações por papel.
6. **Armazenamento S3** via interface `Storage` (já desacoplada).
7. **Provider de IA local/offline** implementando a interface `AIProvider`.
8. **CI**: rodar typecheck/lint/build/tests no push.
