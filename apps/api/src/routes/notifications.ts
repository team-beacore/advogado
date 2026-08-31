import { Router } from 'express';
import { userNotificationPreferencesSchema } from '@advogado/shared';
import { PERMISSIONS } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId, requirePermission } from '../auth/middleware';
import * as notificationService from '../services/notificationService';
import * as notifyService from '../notify/service';
import { getNotificationPreferences, saveNotificationPreferences } from '../services/preferencesService';

const router = Router();

router.use(requireAuth, requireOrg);

router.get('/preferences', async (req, res, next) => {
  try {
    const prefs = await getNotificationPreferences(req.user!.id);
    res.json(prefs);
  } catch (err) { next(err); }
});

router.put('/preferences', async (req, res, next) => {
  try {
    const data = userNotificationPreferencesSchema.parse(req.body);
    const prefs = await saveNotificationPreferences(req.user!.id, data, req.user!.id, req.ip);
    res.json(prefs);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await notificationService.listNotifications(orgId, {
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await notificationService.markNotificationRead(orgId, req.params.id!, req.user?.id ?? null);
    res.json({ ok: true, notification: result });
  } catch (err) { next(err); }
});

router.get('/channels/status', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const status = await notifyService.getChannelStatus(orgId);
    res.json(status);
  } catch (err) { next(err); }
});

router.put('/channels', requirePermission(PERMISSIONS.NOTIFICATIONS_MANAGE), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { channel, enabled } = req.body;
    if (!channel) { res.status(400).json({ code: 'VALIDATION', message: 'channel é obrigatório.' }); return; }
    // ADMIN pode apenas ativar/desativar; a configuração técnica é definida pelo SUPER ADMIN
    const existing = await notifyService.getChannelConfig(orgId, channel);
    await notifyService.saveChannelConfig(orgId, channel, { ...(existing ?? {}), enabled: Boolean(enabled) });
    res.json({ ok: true, channel });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos.', details: (err as { issues: unknown }).issues });
      return;
    }
    next(err);
  }
});

router.get('/deliveries', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await notifyService.listDeliveries(orgId, {
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
    });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;