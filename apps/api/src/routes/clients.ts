import { Router } from 'express';
import { createClientSchema, updateClientSchema, clientNotificationPreferencesSchema, clientPortalInviteSchema, clientCaseShareSchema } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId, requirePermission } from '../auth/middleware';
import { PERMISSIONS } from '@advogado/shared';
import * as clientService from '../services/clientService';
import { getClientNotificationPreferences, saveClientNotificationPreferences } from '../services/preferencesService';
import {
  inviteClientToPortal,
  revokeClientPortal,
  getClientPortal,
  shareCaseWithClient,
  unshareCaseWithClient,
  listClientShares,
} from '../services/portalService';

const router = Router();

router.use(requireAuth, requireOrg);

router.get('/', requirePermission(PERMISSIONS.CLIENTS_READ), async (req, res, next) => {
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

router.post('/', requirePermission(PERMISSIONS.CLIENTS_CREATE), async (req, res, next) => {
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

router.patch('/:id', requirePermission(PERMISSIONS.CLIENTS_UPDATE), async (req, res, next) => {
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

router.get('/:id/notification-preferences', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    await clientService.getClient(orgId, req.params.id!);
    const prefs = await getClientNotificationPreferences(req.params.id!);
    res.json(prefs);
  } catch (err) { next(err); }
});

router.put('/:id/notification-preferences', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    await clientService.getClient(orgId, req.params.id!);
    const data = clientNotificationPreferencesSchema.parse(req.body);
    const prefs = await saveClientNotificationPreferences(req.params.id!, data, req.user!.id, orgId, req.ip);
    res.json(prefs);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.get('/:id/portal', requirePermission(PERMISSIONS.CLIENT_PORTAL_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    await clientService.getClient(orgId, req.params.id!);
    const portal = await getClientPortal(orgId, req.params.id!);
    res.json({ portal });
  } catch (err) { next(err); }
});

router.post('/:id/portal/invite', requirePermission(PERMISSIONS.CLIENT_PORTAL_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = clientPortalInviteSchema.parse(req.body);
    const result = await inviteClientToPortal(orgId, req.params.id!, data.email, req.user!.id, req.ip);
    res.status(201).json(result);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    const status = (err as { status?: number }).status;
    if (status) { res.status(status).json({ code: (err as { code?: string }).code ?? 'ERROR', message: (err as Error).message }); return; }
    next(err);
  }
});

router.delete('/:id/portal', requirePermission(PERMISSIONS.CLIENT_PORTAL_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await revokeClientPortal(orgId, req.params.id!, req.user!.id, req.ip);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id/shares', requirePermission(PERMISSIONS.CLIENT_PORTAL_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const items = await listClientShares(orgId, req.params.id!);
    res.json({ items });
  } catch (err) { next(err); }
});

router.post('/:id/shares', requirePermission(PERMISSIONS.CLIENT_PORTAL_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = clientCaseShareSchema.parse(req.body);
    const share = await shareCaseWithClient(orgId, req.params.id!, data.caseId, data.canViewDocuments, req.user!.id, req.ip);
    res.status(201).json(share);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    const status = (err as { status?: number }).status;
    if (status) { res.status(status).json({ code: (err as { code?: string }).code ?? 'ERROR', message: (err as Error).message }); return; }
    next(err);
  }
});

router.delete('/:id/shares/:caseId', requirePermission(PERMISSIONS.CLIENT_PORTAL_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await unshareCaseWithClient(orgId, req.params.id!, req.params.caseId!, req.user!.id, req.ip);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;