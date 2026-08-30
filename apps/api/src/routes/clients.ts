import { Router } from 'express';
import { createClientSchema, updateClientSchema } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId } from '../auth/middleware';
import * as clientService from '../services/clientService';

const router = Router();

router.use(requireAuth, requireOrg);

router.get('/', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await clientService.listClients(
      orgId,
      typeof req.query.search === 'string' ? req.query.search : undefined,
      req.query.page ? Number(req.query.page) : 1,
      req.query.pageSize ? Number(req.query.pageSize) : 20,
    );
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = createClientSchema.parse(req.body);
    const client = await clientService.createClient(orgId, data, req.user!.id, req.ip);
    res.status(201).json(client);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const client = await clientService.getClient(orgId, req.params.id!);
    const [cases, documents] = await Promise.all([
      clientService.getClientCases(orgId, req.params.id!),
      clientService.getClientDocuments(orgId, req.params.id!),
    ]);
    res.json({ ...client, cases, documents });
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = updateClientSchema.parse(req.body);
    const client = await clientService.updateClient(orgId, req.params.id!, data, req.user!.id, req.ip);
    res.json(client);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

export default router;