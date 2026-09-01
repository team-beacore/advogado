import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../auth/middleware';
import { getPool } from '../db/client';
import { getEnv } from '../config';
import { getProviderInfo } from '../ai/registry';
import { getStorage } from '../storage';
import { auditLog } from '../audit/audit';
import { ScryptHasher } from '../auth/password';
import {
  getWizardState,
  createWizard,
  stepType,
  stepOrganization,
  stepAdministrator,
  stepInfrastructure,
  stepEmail,
  testEmailConnection,
  stepAI,
  testAIConnection,
  stepStorage,
  stepCapture,
  stepNotifications,
  stepSecurity,
  stepFunctional,
  finalizeInstallation,
  resetWizard,
} from '../services/installationService';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const router = Router();
const hasher = new ScryptHasher();

router.use(requireAuth);

router.get('/status', requireSuperAdmin, async (req, res, next) => {
  try {
    const pool = getPool();
    const env = getEnv();
    const [orgsRes, usersRes, migrationsRes, dbOk] = await Promise.all([
      pool.query('SELECT count(*)::int AS count FROM organizations'),
      pool.query('SELECT count(*)::int AS count FROM users'),
      pool.query('SELECT count(*)::int AS n FROM _migrations'),
      pool.query('SELECT 1').then(() => true).catch(() => false),
    ]);
    const ai = getProviderInfo();
    let storageOk = false;
    try {
      const storage = getStorage();
      const key = `.health-${Date.now()}`;
      await storage.save(Buffer.from('ok'), key);
      const buf = await storage.read(key);
      await storage.delete(key);
      storageOk = buf.toString() === 'ok';
    } catch { storageOk = false; }
    res.json({
      ok: dbOk,
      version: '1.0.0',
      environment: env.NODE_ENV,
      database: dbOk,
      storage: { driver: env.STORAGE_DRIVER, ok: storageOk },
      migrations: migrationsRes.rows[0]?.n ?? 0,
      ai: { provider: ai.name, configured: ai.configured },
      services: {
        api: true,
        database: dbOk,
        storage: storageOk,
        migrations: (migrationsRes.rows[0]?.n ?? 0) >= 1,
      },
      counts: {
        organizations: orgsRes.rows[0]?.count ?? 0,
        users: usersRes.rows[0]?.count ?? 0,
      },
    });
  } catch (err) { next(err); }
});

/**
 * Bootstrap de instalação — cria a organização e o primeiro administrador.
 * O SUPER ADMIN (implantador) NÃO é adicionado como membro da organização.
 * Usado apenas durante a implantação inicial na VPS do cliente.
 * Body: { orgName, adminEmail, adminPassword, adminName }
 */
router.post('/bootstrap', requireSuperAdmin, async (req, res, next) => {
  try {
    const { orgName, adminEmail, adminPassword, adminName } = req.body;
    if (!orgName || !adminEmail || !adminPassword || !adminName) {
      res.status(400).json({ code: 'VALIDATION', message: 'orgName, adminEmail, adminPassword e adminName são obrigatórios.' });
      return;
    }
    if (adminPassword.length < 8) {
      res.status(400).json({ code: 'VALIDATION', message: 'Senha deve ter no mínimo 8 caracteres.' });
      return;
    }

    const pool = getPool();

    // 1. Criar ou localizar o usuário administrador
    let adminId: string;
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    if (existing.rows.length > 0) {
      adminId = existing.rows[0].id;
      // Se o usuário já existe mas é super admin, não pode ser admin da organização
      const sa = await pool.query('SELECT is_super_admin FROM users WHERE id = $1', [adminId]);
      if (sa.rows[0]?.is_super_admin) {
        res.status(400).json({ code: 'VALIDATION', message: 'Usuário SUPER ADMIN não pode ser administrador da organização.' });
        return;
      }
    } else {
      const hash = hasher.hash(adminPassword);
      const userRes = await pool.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [adminName, adminEmail, hash],
      );
      adminId = userRes.rows[0].id;
    }

    // 2. Criar organização
    const orgRes = await pool.query('INSERT INTO organizations (name) VALUES ($1) RETURNING *', [orgName]);
    const org = orgRes.rows[0];

    // 3. Associar admin à organização (NÃO adiciona o SUPER ADMIN)
    await pool.query(
      'INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)',
      [org.id, adminId, 'ADMIN'],
    );

    // 4. Auditoria
    void auditLog({ organizationId: org.id, userId: req.user!.id, action: 'ORGANIZATION_BOOTSTRAPPED', entity: 'organization', entityId: org.id, after: { name: orgName, adminEmail }, ip: req.ip });

    res.status(201).json({
      organization: { id: org.id, name: org.name },
      admin: { id: adminId, email: adminEmail, name: adminName },
    });
  } catch (err) { next(err); }
});

// ==================== WIZARD DE IMPLANTAÇÃO ====================

router.get('/installation', requireSuperAdmin, async (_req, res, next) => {
  try {
    const state = await getWizardState();
    res.json({ installation: state ? { ...state, data: sanitizeWizardData(state.data) } : null });
  } catch (err) { next(err); }
});

router.post('/installation', requireSuperAdmin, async (req, res, next) => {
  try {
    const clientType = req.body.clientType === 'escritorio' ? 'escritorio' : req.body.clientType === 'solo' ? 'solo' : undefined;
    const state = await createWizard(clientType);
    res.status(201).json({ installation: { ...state, data: sanitizeWizardData(state.data) } });
  } catch (err) { next(err); }
});

router.post('/installation/reset', requireSuperAdmin, async (_req, res, next) => {
  try {
    const state = await resetWizard();
    res.json({ installation: { ...state, data: sanitizeWizardData(state.data) } });
  } catch (err) { next(err); }
});

router.post('/installation/step/type', requireSuperAdmin, async (req, res, _next) => {
  try {
    const state = await getWizardState();
    if (!state) throw err400('Nenhuma implantação em andamento.');
    const updated = await stepType(state, req.body);
    res.json({ installation: { ...updated, data: sanitizeWizardData(updated.data) } });
  } catch (err) { handleStepError(res, err); }
});

router.post('/installation/step/organization', requireSuperAdmin, async (req, res, _next) => {
  try {
    const state = await getWizardState();
    if (!state) throw err400('Nenhuma implantação em andamento.');
    if (!state.clientType) throw err400('Selecione o tipo de contratação primeiro.');
    const updated = await stepOrganization(state, req.body);
    res.json({ installation: { ...updated, data: sanitizeWizardData(updated.data) } });
  } catch (err) { handleStepError(res, err); }
});

router.post('/installation/step/administrator', requireSuperAdmin, async (req, res, _next) => {
  try {
    const state = await getWizardState();
    if (!state) throw err400('Nenhuma implantação em andamento.');
    const updated = await stepAdministrator(state, req.body);
    res.json({ installation: { ...updated, data: sanitizeWizardData(updated.data) } });
  } catch (err) { handleStepError(res, err); }
});

router.post('/installation/step/infrastructure', requireSuperAdmin, async (_req, res, _next) => {
  try {
    const state = await getWizardState();
    if (!state) throw err400('Nenhuma implantação em andamento.');
    const updated = await stepInfrastructure(state);
    res.json({ installation: { ...updated, data: sanitizeWizardData(updated.data) } });
  } catch (err) { handleStepError(res, err); }
});

router.post('/installation/step/email', requireSuperAdmin, async (req, res, _next) => {
  try {
    const state = await getWizardState();
    if (!state) throw err400('Nenhuma implantação em andamento.');
    const updated = await stepEmail(state, req.body);
    res.json({ installation: { ...updated, data: sanitizeWizardData(updated.data) } });
  } catch (err) { handleStepError(res, err); }
});

router.post('/installation/step/ai', requireSuperAdmin, async (req, res, _next) => {
  try {
    const state = await getWizardState();
    if (!state) throw err400('Nenhuma implantação em andamento.');
    const updated = await stepAI(state, req.body);
    res.json({ installation: { ...updated, data: sanitizeWizardData(updated.data) } });
  } catch (err) { handleStepError(res, err); }
});

router.post('/installation/step/storage', requireSuperAdmin, async (_req, res, _next) => {
  try {
    const state = await getWizardState();
    if (!state) throw err400('Nenhuma implantação em andamento.');
    const updated = await stepStorage(state);
    res.json({ installation: { ...updated, data: sanitizeWizardData(updated.data) } });
  } catch (err) { handleStepError(res, err); }
});

router.post('/installation/step/capture', requireSuperAdmin, async (_req, res, _next) => {
  try {
    const state = await getWizardState();
    if (!state) throw err400('Nenhuma implantação em andamento.');
    const updated = await stepCapture(state);
    res.json({ installation: { ...updated, data: sanitizeWizardData(updated.data) } });
  } catch (err) { handleStepError(res, err); }
});

router.post('/installation/step/notifications', requireSuperAdmin, async (req, res, _next) => {
  try {
    const state = await getWizardState();
    if (!state) throw err400('Nenhuma implantação em andamento.');
    const updated = await stepNotifications(state, req.body);
    res.json({ installation: { ...updated, data: sanitizeWizardData(updated.data) } });
  } catch (err) { handleStepError(res, err); }
});

router.post('/installation/step/security', requireSuperAdmin, async (_req, res, _next) => {
  try {
    const state = await getWizardState();
    if (!state) throw err400('Nenhuma implantação em andamento.');
    const updated = await stepSecurity(state);
    res.json({ installation: { ...updated, data: sanitizeWizardData(updated.data) } });
  } catch (err) { handleStepError(res, err); }
});

router.post('/installation/step/functional', requireSuperAdmin, async (_req, res, _next) => {
  try {
    const state = await getWizardState();
    if (!state) throw err400('Nenhuma implantação em andamento.');
    const updated = await stepFunctional(state);
    res.json({ installation: { ...updated, data: sanitizeWizardData(updated.data) } });
  } catch (err) { handleStepError(res, err); }
});

router.post('/installation/finalize', requireSuperAdmin, async (_req, res, _next) => {
  try {
    const state = await getWizardState();
    if (!state) throw err400('Nenhuma implantação em andamento.');
    const updated = await finalizeInstallation(state);
    res.json({ installation: { ...updated, data: sanitizeWizardData(updated.data) } });
  } catch (err) { handleStepError(res, err); }
});

// Testes isolados (retry sem refazer implantação)
router.post('/installation/test/email', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await testEmailConnection(req.body);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/installation/test/ai', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await testAIConnection(req.body);
    res.json(result);
  } catch (err) { next(err); }
});

// Relatório PDF
router.get('/installation/report', requireSuperAdmin, async (_req, res, next) => {
  try {
    const state = await getWizardState();
    if (!state) throw err400('Nenhuma implantação concluída.');
    const includePassword = _req.query.includePassword === 'true';
    const pdf = await buildInstallationReport(state, includePassword);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="relatorio-implantacao.pdf"');
    res.send(Buffer.from(pdf));
  } catch (err) { next(err); }
});

// Lista as instalações existentes (uma por VPS; preparado para múltiplas no futuro)
router.get('/installations', requireSuperAdmin, async (_req, res, next) => {
  try {
    const pool = getPool();
    const res2 = await pool.query(
      `SELECT o.id, o.name, o.plan_type, o.created_at,
              w.wizard_data, w.updated_at AS last_validation_at
       FROM organizations o
       LEFT JOIN installation_wizard w ON w.organization_id = o.id
       ORDER BY o.created_at DESC`,
    );
    const items = res2.rows.map((row) => {
      const wizardData = (row.wizard_data ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        name: row.name,
        plan: row.plan_type === 'OFFICE' ? 'OFFICE' : 'SOLO',
        createdAt: row.created_at,
        lastValidationAt: row.last_validation_at ?? null,
        ready: wizardData.ready === true,
        stepSummary: sanitizeWizardData(wizardData),
      };
    });
    res.json({ installations: items });
  } catch (err) { next(err); }
});

/** Remove segredos antes de devolver o estado ao frontend. */
function sanitizeWizardData(data: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...data };
  if ('adminInitialPassword' in copy) delete copy.adminInitialPassword;
  if (copy.email && typeof copy.email === 'object') {
    const e = copy.email as Record<string, unknown>;
    delete e.pass;
  }
  if (copy.ai && typeof copy.ai === 'object') {
    const a = copy.ai as Record<string, unknown>;
    delete a.apiKey;
  }
  return copy;
}

function err400(message: string): { status: number; message: string } {
  return { status: 400, message };
}

function handleStepError(res: import('express').Response, err: unknown): void {
  const e = err as { status?: number; message?: string };
  res.status(e?.status ?? 400).json({ code: 'VALIDATION', message: e?.message ?? 'Erro na etapa.' });
}

async function buildInstallationReport(state: NonNullable<Awaited<ReturnType<typeof getWizardState>>>, includePassword: boolean): Promise<Uint8Array> {
  if (!state) throw err400('Nenhuma implantação.');
  const d = state.data;
  const steps = state.steps;
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
  const ok = (s: string | undefined) => (s === 'OK' ? 'Concluído' : s === 'FAILED' ? 'Falhou' : 'Pendente');

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage();
  let y = 760;

  const heading = (text: string) => {
    if (y < 60) { page = doc.addPage(); y = 760; }
    page.drawText(text, { x: 50, y, size: 16, font: bold, color: rgb(0.12, 0.23, 0.54) });
    y -= 24;
  };
  const line = (label: string, value: string) => {
    if (y < 40) { page = doc.addPage(); y = 760; }
    page.drawText(`${label}:`, { x: 50, y, size: 10, font: bold, color: rgb(0.3, 0.35, 0.4) });
    page.drawText(value || '—', { x: 170, y, size: 10, font, color: rgb(0.15, 0.16, 0.2) });
    y -= 16;
  };
  const text = (t: string, sz: number, col: { r: number; g: number; b: number }) => {
    if (y < 40) { page = doc.addPage(); y = 760; }
    page.drawText(t, { x: 50, y, size: sz, font, color: rgb(col.r, col.g, col.b) });
    y -= sz + 4;
  };

  page.drawText('RELATÓRIO DE IMPLANTAÇÃO', { x: 50, y, size: 20, font: bold, color: rgb(0.12, 0.23, 0.54) });
  y -= 28;
  text(`Sistema Jurídico — Versão 1.0.0`, 10, { r: 0.3, g: 0.35, b: 0.4 });
  text(`Data da implantação: ${fmt(d.finishedAt ? String(d.finishedAt) : new Date().toISOString())}`, 10, { r: 0.3, g: 0.35, b: 0.4 });
  y -= 10;

  heading('DADOS DA ORGANIZAÇÃO');
  line('Nome', String(d.orgName ?? ''));
  line('CNPJ/CPF', String(d.orgCnpj ?? ''));
  line('OAB', String(d.orgOab ?? ''));
  line('UF', String(d.orgUf ?? ''));
  line('Tipo', state.clientType === 'escritorio' ? 'Escritório' : state.clientType === 'solo' ? 'Advogado Solo' : '—');
  line('Plano', state.clientType === 'escritorio' ? 'OFFICE' : state.clientType === 'solo' ? 'SOLO' : '—');
  y -= 6;

  heading('ADMINISTRADOR');
  line('Nome', String(d.adminName ?? ''));
  line('Email', String(d.adminEmail ?? ''));
  line('Telefone', String(d.adminPhone ?? ''));
  line('Perfil', 'ADMIN + LAWYER');
  if (includePassword && d.adminInitialPassword) {
    line('Senha inicial temporária', String(d.adminInitialPassword));
    page.drawText('IMPORTANTE: credencial temporária de implantação. O administrador deve alterá-la imediatamente após o primeiro acesso.', { x: 50, y: y - 4, size: 9, font, color: rgb(0.8, 0.2, 0.2) });
    y -= 20;
  }
  y -= 4;

  heading('INTEGRAÇÕES');
  line('SMTP', ok(steps.email?.status));
  line('IA', ok(steps.ai?.status));
  line('Storage', ok(steps.storage?.status));
  line('Captura', ok(steps.capture?.status));
  y -= 6;

  heading('INTELIGÊNCIA ARTIFICIAL');
  const ai = (d.ai ?? {}) as Record<string, unknown>;
  line('Provider', String(ai.provider ?? ''));
  line('Modelo', String(ai.model ?? ''));
  line('Teste técnico', ok(steps.ai?.status));
  line('Última validação', fmt(String(ai.testedAt ?? '')));
  y -= 6;

  heading('STATUS DA IMPLANTAÇÃO');
  page.drawText(d.ready === true ? 'PRONTA PARA ENTREGA' : 'EM ANDAMENTO', { x: 50, y, size: 14, font: bold, color: rgb(0.1, 0.6, 0.3) });
  y -= 30;

  page = doc.addPage();
  y = 760;
  heading('CHECKLIST DE SEGURANÇA E TESTES');
  for (const s of ['type', 'organization', 'administrator', 'infrastructure', 'email', 'ai', 'storage', 'capture', 'notifications', 'security', 'functional', 'summary']) {
    line(s, `${ok(steps[s]?.status)} — ${fmt(steps[s]?.testedAt ?? '')}`);
  }
  page.drawText('— Fim do relatório —', { x: 50, y: y - 20, size: 10, font, color: rgb(0.6, 0.6, 0.6) });

  return await doc.save();
}

export default router;
