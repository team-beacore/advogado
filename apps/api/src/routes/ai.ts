import { Router } from 'express';
import { aiDraftSchema } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId } from '../auth/middleware';
import { AIService } from '../services/aiService';
import { getAIProvider, getProviderInfo } from '../ai/registry';

const router = Router();

function createService() {
  return new AIService(getAIProvider());
}

router.use(requireAuth, requireOrg);

router.get('/status', (_req, res) => {
  const info = getProviderInfo();
  res.json({
    configured: info.configured,
    provider: info.name,
    disclaimer: new AIService(getAIProvider()).getDisclaimer(),
  });
});

router.get('/interactions', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await createService().listInteractions(orgId, {
      processId: typeof req.query.processId === 'string' ? req.query.processId : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/processes/:processId/summarize', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await createService().summarize(orgId, req.params.processId!, req.user!.id, req.ip, req.user!.role);
    res.json(result);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'AI_NOT_CONFIGURED') {
      res.status(503).json({ code: 'AI_NOT_CONFIGURED', message: 'Serviço de IA não configurado. Configure a chave da API no ambiente.' });
      return;
    }
    next(err);
  }
});

router.post('/processes/:processId/analyze-publication/:publicationId', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await createService().analyzePublication(orgId, req.params.processId!, req.params.publicationId!, req.user!.id, req.ip, req.user!.role);
    res.json(result);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'AI_NOT_CONFIGURED') {
      res.status(503).json({ code: 'AI_NOT_CONFIGURED', message: 'Serviço de IA não configurado. Configure a chave da API no ambiente.' });
      return;
    }
    next(err);
  }
});

router.post('/processes/:processId/draft', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = aiDraftSchema.parse(req.body);
    const result = await createService().draft(orgId, req.params.processId!, data.instruction, req.user!.id, req.ip, req.user!.role);
    res.json(result);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'AI_NOT_CONFIGURED') {
      res.status(503).json({ code: 'AI_NOT_CONFIGURED', message: 'Serviço de IA não configurado. Configure a chave da API no ambiente.' });
      return;
    }
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.post('/interactions/:interactionId/review', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { status, editedOutput } = req.body;
    if (!['APPROVED', 'EDITED', 'REJECTED'].includes(status)) {
      res.status(400).json({ code: 'VALIDATION', message: 'Status inválido. Use: APPROVED, EDITED ou REJECTED.' });
      return;
    }
    const result = await createService().reviewInteraction(orgId, req.params.interactionId!, req.user!.id, status, editedOutput ?? null, req.ip);
    res.json({ approval: result, disclaimer: createService().getDisclaimer() });
  } catch (err) { next(err); }
});

export default router;