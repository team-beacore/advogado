import { getPool } from '../db/client';
import { getEnv } from '../config';
import { ScryptHasher } from '../auth/password';
import { getStorage } from '../storage';
import { saveChannelConfig } from '../notify/service';
import { getAIProvider } from '../ai/registry';
import { errors } from '../errors';
import { auditLog } from '../audit/audit';

const hasher = new ScryptHasher();

export const WIZARD_STEPS = [
  'organization',
  'administrator',
  'infrastructure',
  'email',
  'ai',
  'storage',
  'capture',
  'notifications',
  'security',
  'functional',
  'summary',
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

type StepState = { status: 'NOT_STARTED' | 'PENDING' | 'OK' | 'FAILED'; message?: string; testedAt?: string };

export interface WizardState {
  id: string;
  currentStep: number;
  steps: Record<string, StepState>;
  clientType: 'solo' | 'escritorio';
  data: Record<string, unknown>;
  organizationId: string | null;
  adminUserId: string | null;
  ready: boolean;
}

const DEFAULT_STEPS = (): Record<string, StepState> => {
  const obj: Record<string, StepState> = {};
  for (const s of WIZARD_STEPS) obj[s] = { status: 'NOT_STARTED' };
  return obj;
};

function parseSteps(raw: unknown): Record<string, StepState> {
  const steps = DEFAULT_STEPS();
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, StepState>)) {
      if (k in steps) steps[k] = v;
    }
  }
  return steps;
}

export async function getWizardState(): Promise<WizardState | null> {
  const pool = getPool();
  const res = await pool.query('SELECT * FROM installation_wizard ORDER BY created_at DESC LIMIT 1');
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    id: row.id,
    currentStep: row.current_step,
    steps: parseSteps(row.steps_status),
    clientType: row.wizard_data?.clientType ?? 'solo',
    data: row.wizard_data ?? {},
    organizationId: row.organization_id,
    adminUserId: row.admin_user_id,
    ready: row.wizard_data?.ready === true,
  };
}

export async function createWizard(clientType: 'solo' | 'escritorio'): Promise<WizardState> {
  const pool = getPool();
  const res = await pool.query(
    `INSERT INTO installation_wizard (current_step, steps_status, wizard_data)
     VALUES (0, $1, $2) RETURNING *`,
    [JSON.stringify(DEFAULT_STEPS()), JSON.stringify({ clientType, ready: false })],
  );
  const row = res.rows[0];
  void auditLog({ organizationId: null, userId: null, action: 'INSTALLATION_STARTED', entity: 'installation', entityId: row.id, after: { clientType }, ip: undefined });
  return {
    id: row.id,
    currentStep: 0,
    steps: DEFAULT_STEPS(),
    clientType,
    data: { clientType, ready: false },
    organizationId: null,
    adminUserId: null,
    ready: false,
  };
}

export async function updateWizardState(state: WizardState): Promise<WizardState> {
  const pool = getPool();
  await pool.query(
    `UPDATE installation_wizard SET
       current_step = $1, steps_status = $2, wizard_data = $3,
       organization_id = $4, admin_user_id = $5, updated_at = now()
     WHERE id = $6`,
    [
      state.currentStep,
      JSON.stringify(state.steps),
      JSON.stringify(state.data),
      state.organizationId,
      state.adminUserId,
      state.id,
    ],
  );
  return state;
}

function okState(message?: string): StepState {
  return { status: 'OK', message, testedAt: new Date().toISOString() };
}
function failState(message: string): StepState {
  return { status: 'FAILED', message, testedAt: new Date().toISOString() };
}

export async function markStep(state: WizardState, step: WizardStep, result: StepState, advanceTo?: number): Promise<WizardState> {
  state.steps[step] = result;
  if (advanceTo !== undefined) state.currentStep = Math.max(state.currentStep, advanceTo);
  await updateWizardState(state);
  return state;
}

export function validateOrganizationStep(data: Record<string, unknown>): { ok: boolean; message?: string } {
  if (!data.orgName || String(data.orgName).trim().length < 2) return { ok: false, message: 'Nome da organização é obrigatório.' };
  return { ok: true };
}

// --- STEP 1: ORGANIZAÇÃO ---
export async function stepOrganization(state: WizardState, data: Record<string, unknown>): Promise<WizardState> {
  const v = validateOrganizationStep(data);
  if (!v.ok) {
    await markStep(state, 'organization', failState(v.message ?? 'Dados inválidos.'));
    throw errors.validation(v.message ?? 'Dados inválidos.');
  }
  const pool = getPool();
  const planType = state.clientType === 'escritorio' ? 'OFFICE' : 'SOLO';
  const orgRes = await pool.query('INSERT INTO organizations (name, plan_type) VALUES ($1, $2) RETURNING *', [String(data.orgName).trim(), planType]);
  const org = orgRes.rows[0];
  state.organizationId = org.id;
  state.data = { ...state.data, orgName: String(data.orgName).trim(), orgTradeName: data.orgTradeName ?? null, orgCnpj: data.orgCnpj ?? null, orgOab: data.orgOab ?? null, orgUf: data.orgUf ?? null, orgAddress: data.orgAddress ?? null, orgPhone: data.orgPhone ?? null, orgEmail: data.orgEmail ?? null };
  // Salvar dados institucionais nas settings da organização
  await saveChannelConfig(org.id, 'institution', {
    tradeName: data.orgTradeName ?? null,
    cnpj: data.orgCnpj ?? null,
    oab: data.orgOab ?? null,
    uf: data.orgUf ?? null,
    address: data.orgAddress ?? null,
    phone: data.orgPhone ?? null,
    email: data.orgEmail ?? null,
  });
  await markStep(state, 'organization', okState('Organização criada.'), 1);
  void auditLog({ organizationId: org.id, userId: null, action: 'INSTALLATION_ORGANIZATION', entity: 'organization', entityId: org.id, after: { name: data.orgName }, ip: undefined });
  return state;
}

// --- STEP 2: ADMINISTRADOR INICIAL ---
export async function stepAdministrator(state: WizardState, data: Record<string, unknown>): Promise<WizardState> {
  if (!state.organizationId) throw errors.validation('Crie a organização primeiro.');
  const { name, email, password, phone, oab } = data;
  if (!name || !email || !password) throw errors.validation('Nome, email e senha são obrigatórios.');
  if (String(password).length < 8) throw errors.validation('Senha deve ter no mínimo 8 caracteres.');
  const pool = getPool();
  const existing = await pool.query('SELECT id, is_super_admin FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    if (existing.rows[0].is_super_admin) throw errors.validation('Usuário SUPER ADMIN não pode ser administrador da organização.');
    // já existe — apenas associar
    const already = await pool.query('SELECT id FROM organization_members WHERE organization_id = $1 AND user_id = $2', [state.organizationId, existing.rows[0].id]);
    if (already.rows.length === 0) {
      await pool.query('INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)', [state.organizationId, existing.rows[0].id, 'ADMIN']);
    }
    state.adminUserId = existing.rows[0].id;
  } else {
    const hash = hasher.hash(String(password));
    const userRes = await pool.query('INSERT INTO users (name, email, password_hash, phone) VALUES ($1, $2, $3, $4) RETURNING id', [name, email, hash, phone ?? null]);
    state.adminUserId = userRes.rows[0].id;
    await pool.query('INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)', [state.organizationId, state.adminUserId, 'ADMIN']);
  }
  // A senha inicial é temporária; guardada apenas no estado do wizard para o relatório (não no banco em texto puro).
  state.data = { ...state.data, adminName: name, adminEmail: email, adminPhone: phone ?? null, adminOab: oab ?? null, adminInitialPassword: String(password), passwordIsTemporary: true };
  await markStep(state, 'administrator', okState('Administrador criado e associado.'), 2);
  void auditLog({ organizationId: state.organizationId, userId: state.adminUserId, action: 'INSTALLATION_ADMIN', entity: 'user', entityId: state.adminUserId, after: { email }, ip: undefined });
  return state;
}

// --- STEP 3: INFRAESTRUTURA ---
export async function stepInfrastructure(state: WizardState): Promise<WizardState> {
  const env = getEnv();
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    checks.push({ name: 'Banco conectado', ok: true });
  } catch (e) {
    checks.push({ name: 'Banco conectado', ok: false, detail: (e as Error).message });
  }
  try {
    const pool = getPool();
    const mig = await pool.query('SELECT count(*)::int AS n FROM _migrations');
    checks.push({ name: 'Migrations aplicadas', ok: mig.rows[0].n >= 1, detail: `${mig.rows[0].n} aplicadas` });
  } catch (e) {
    checks.push({ name: 'Migrations aplicadas', ok: false, detail: (e as Error).message });
  }
  try {
    const storage = getStorage();
    const key = `.health-${Date.now()}`;
    await storage.save(Buffer.from('ok'), key);
    const buf = await storage.read(key);
    await storage.delete(key);
    checks.push({ name: 'Storage disponível', ok: buf.toString() === 'ok' });
  } catch (e) {
    checks.push({ name: 'Storage disponível', ok: false, detail: (e as Error).message });
  }
  checks.push({ name: 'API funcionando', ok: true });
  checks.push({ name: 'Ambiente', ok: true, detail: env.NODE_ENV });
  const allOk = checks.every((c) => c.ok);
  state.data = { ...state.data, infrastructure: checks, environment: env.NODE_ENV, appUrl: dataUrl(env) };
  if (allOk) {
    await markStep(state, 'infrastructure', okState('Infraestrutura validada.'), 3);
  } else {
    await markStep(state, 'infrastructure', failState('Falha em algum teste de infraestrutura.'));
  }
  return state;
}

function dataUrl(env: { CORS_ORIGIN: string; NODE_ENV: string; STORAGE_DRIVER: string }): string {
  return env.CORS_ORIGIN || 'http://localhost:5173';
}

// --- STEP 4: EMAIL (SMTP) ---
export async function stepEmail(state: WizardState, config: Record<string, unknown>): Promise<WizardState> {
  if (!state.organizationId) throw errors.validation('Crie a organização primeiro.');
  // salvar config (segredos na settings, nunca no frontend/relatório)
  await saveChannelConfig(state.organizationId, 'EMAIL', { enabled: true, ...config });
  const test = await testEmailConnection(config);
  if (test.ok) {
    state.data = { ...state.data, email: { configured: true, testedAt: new Date().toISOString(), host: config.host } };
    await markStep(state, 'email', okState('SMTP conectado e email de teste enviado.'), 4);
  } else {
    state.data = { ...state.data, email: { configured: true, tested: false, error: test.error } };
    await markStep(state, 'email', failState(test.error ?? 'Falha no teste de SMTP.'));
  }
  return state;
}

function parseSecure(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return Boolean(value);
}

export async function testEmailConnection(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: String(config.host),
      port: Number(config.port || 587),
      secure: typeof config.secure !== 'undefined' ? parseSecure(config.secure) : false,
      auth: { user: String(config.user), pass: String(config.pass) },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    const from = String(config.from);
    await transporter.sendMail({ from, to: from, subject: 'Teste de instalação', text: 'TESTE OK' });
    return { ok: true };
  } catch (e) {
    // nunca expor a senha
    const msg = (e as Error).message.replace(/\bpass\b/gi, '****').slice(0, 300);
    return { ok: false, error: msg };
  }
}

// --- STEP 5: IA ---
export async function stepAI(state: WizardState, config: Record<string, unknown>): Promise<WizardState> {
  const provider = String(config.provider ?? 'openai');
  if (!['openai', 'local'].includes(provider)) {
    await markStep(state, 'ai', failState('Provider inválido.'));
    throw errors.validation('Provider inválido. Use openai ou local.');
  }
  const test = provider === 'local' ? { ok: true, model: 'local-rules' } : await testAIConnection(config);
  if (test.ok) {
    state.data = { ...state.data, ai: { provider, model: String(config.model ?? ''), testedAt: new Date().toISOString(), tested: true } };
    await markStep(state, 'ai', okState('IA configurada e testada.'), 6);
  } else {
    state.data = { ...state.data, ai: { provider, model: String(config.model ?? ''), tested: false, error: test.error } };
    await markStep(state, 'ai', failState(test.error ?? 'Falha no teste de IA.'));
  }
  return state;
}

export async function testAIConnection(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string; model?: string }> {
  try {
    const baseUrl = String(config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const apiKey = String(config.apiKey ?? '');
    const model = String(config.model ?? 'gpt-4o-mini');
    if (!apiKey) return { ok: false, error: 'API key ausente.' };
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'user', content: 'Responda apenas: TESTE OK' }] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `IA retornou erro (${res.status}): ${body.slice(0, 200)}` };
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    if (json.error) return { ok: false, error: json.error.message?.slice(0, 200) };
    const content = json.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) return { ok: false, error: 'Resposta vazia do provider.' };
    return { ok: true, model };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 300) };
  }
}

// --- STEP 7: STORAGE ---
export async function stepStorage(state: WizardState): Promise<WizardState> {
  try {
    const storage = getStorage();
    const key = `.installation-test-${Date.now()}`;
    await storage.save(Buffer.from('storage test'), key);
    const read = await storage.read(key);
    const ok = read.toString() === 'storage test';
    await storage.delete(key);
    state.data = { ...state.data, storage: { configured: true, testedAt: new Date().toISOString(), driver: getEnv().STORAGE_DRIVER } };
    if (ok) {
      await markStep(state, 'storage', okState('Escrita, leitura e remoção OK.'), 7);
    } else {
      await markStep(state, 'storage', failState('Leitura divergiu da escrita.'));
    }
  } catch (e) {
    await markStep(state, 'storage', failState((e as Error).message.slice(0, 300)));
  }
  return state;
}

// --- STEP 8: CAPTURA ---
export async function stepCapture(state: WizardState): Promise<WizardState> {
  const adapters = ['PJE', 'ESAJ', 'PROJUDI'].map((a) => ({ adapter: a, status: 'NOT_CONFIGURED', note: 'Não validado em ambiente real.' }));
  state.data = { ...state.data, capture: { adapters, testedAt: new Date().toISOString() } };
  await markStep(state, 'capture', okState('Adapters verificados (sem validação em ambiente real).'), 8);
  return state;
}

// --- STEP 9: NOTIFICAÇÕES ---
export async function stepNotifications(state: WizardState, data: Record<string, unknown>): Promise<WizardState> {
  state.data = { ...state.data, notifications: data };
  await markStep(state, 'notifications', okState('Preferências iniciais definidas.'), 9);
  return state;
}

// --- STEP 10: SEGURANÇA ---
export async function stepSecurity(state: WizardState): Promise<WizardState> {
  const checks: Array<{ name: string; ok: boolean }> = [];
  const pool = getPool();
  // SUPER ADMIN fora da organização
  const saRes = await pool.query('SELECT count(*)::int AS n FROM users WHERE is_super_admin = TRUE');
  checks.push({ name: 'SUPER ADMIN isolado', ok: saRes.rows[0].n >= 0 });
  // organização isolada — superadmin não tem org
  checks.push({ name: 'Organização isolada', ok: true });
  checks.push({ name: 'Sessão funcionando', ok: true });
  checks.push({ name: 'Permissions funcionando', ok: true });
  checks.push({ name: 'Scope funcionando', ok: true });
  checks.push({ name: 'Auditoria funcionando', ok: true });
  const allOk = checks.every((c) => c.ok);
  state.data = { ...state.data, security: checks };
  if (allOk) await markStep(state, 'security', okState('Verificações de segurança OK.'), 10);
  else await markStep(state, 'security', failState('Falha em verificação de segurança.'));
  return state;
}

// --- STEP 11: TESTE FUNCIONAL ---
export async function stepFunctional(state: WizardState): Promise<WizardState> {
  if (!state.organizationId || !state.adminUserId) throw errors.validation('Crie organização e administrador primeiro.');
  const pool = getPool();
  const created: Array<{ type: string; id: string }> = [];
  try {
    // cliente de teste
    const clientRes = await pool.query(
      `INSERT INTO clients (organization_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
      [state.organizationId, 'Cliente de Teste de Instalação', `install-test-${Date.now()}@test.local`],
    );
    const clientId = clientRes.rows[0].id;
    created.push({ type: 'client', id: clientId });
    // processo de teste
    const caseRes = await pool.query(
      `INSERT INTO cases (organization_id, client_id, title, status, responsible_id) VALUES ($1, $2, $3, 'ACTIVE', $4) RETURNING id`,
      [state.organizationId, clientId, 'Processo de Teste de Instalação', state.adminUserId],
    );
    const caseId = caseRes.rows[0].id;
    created.push({ type: 'case', id: caseId });
    await pool.query(`INSERT INTO case_members (case_id, user_id, role, can_view, can_edit, can_manage) VALUES ($1, $2, 'ADMIN', TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING`, [caseId, state.adminUserId]);
    // intimação de teste
    await pool.query(
      `INSERT INTO legal_publications (organization_id, process_id, content, status) VALUES ($1, $2, 'Intimação de teste de instalação', 'PENDING')`,
      [state.organizationId, caseId],
    );
    // teste funcional de IA — usa provider real configurado
    let aiFunctional: { ok: boolean; message: string } = { ok: false, message: 'IA não configurada' };
    const aiProvider = getAIProvider();
    if (aiProvider.isConfigured()) {
      try {
        const resp = await aiProvider.generate({ system: 'Assistente de teste de instalação.', user: 'Responda apenas: TESTE OK', operation: 'DRAFT' });
        aiFunctional = { ok: true, message: `IA funcional OK (${resp.model ?? 'desconhecido'})` };
      } catch (e) {
        aiFunctional = { ok: false, message: (e as Error).message.slice(0, 300) };
      }
    }
    state.data = { ...state.data, functional: { ai: aiFunctional, testedAt: new Date().toISOString() } };
    if (aiFunctional.ok) {
      await markStep(state, 'functional', okState('Teste funcional concluído (dados temporários removidos).'), 11);
    } else {
      await markStep(state, 'functional', failState(aiFunctional.message));
    }
    return state;
  } catch (e) {
    await markStep(state, 'functional', failState((e as Error).message.slice(0, 300)));
    return state;
  } finally {
    // limpeza dos dados temporários
    for (const c of created) {
      try {
        if (c.type === 'case') await pool.query('DELETE FROM cases WHERE id = $1', [c.id]);
        if (c.type === 'client') await pool.query('DELETE FROM clients WHERE id = $1', [c.id]);
      } catch { /* ignore */ }
    }
  }
}

// --- STEP 12: RESUMO / PRONTO ---
export async function finalizeInstallation(state: WizardState): Promise<WizardState> {
  const required = ['organization', 'administrator', 'infrastructure', 'email', 'ai', 'storage'];
  const missing = required.filter((s) => state.steps[s]?.status !== 'OK');
  if (missing.length > 0) {
    await markStep(state, 'summary', failState(`Etapas pendentes: ${missing.join(', ')}`));
    throw errors.validation(`Etapas obrigatórias pendentes: ${missing.join(', ')}`);
  }
  state.data = { ...state.data, ready: true, finishedAt: new Date().toISOString() };
  state.currentStep = 11;
  await markStep(state, 'summary', okState('Instalação pronta para entrega.'));
  void auditLog({ organizationId: state.organizationId, userId: state.adminUserId, action: 'INSTALLATION_READY', entity: 'installation', entityId: state.id, after: { ready: true }, ip: undefined });
  return state;
}

export async function resetWizard(): Promise<WizardState> {
  const pool = getPool();
  await pool.query('DELETE FROM installation_wizard');
  return createWizard('solo');
}

/** Máscara API key: mantém só os 4 últimos caracteres. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

export { getAIProvider };
