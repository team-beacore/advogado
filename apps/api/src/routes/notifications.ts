import { Router } from 'express';
import { updateNotificationChannelSchema } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId, requireRole } from '../auth/middleware';
import * as notificationService from '../services/notificationService';
import * as notifyService from '../notify/service';

const router = Router();

router.use(requireAuth, requireOrg);

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

router.put('/channels', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const data = updateNotificationChannelSchema.parse(req.body);
    const config = { enabled: data.enabled, ...data.config };
    await notifyService.saveChannelConfig(orgId, data.channel, config);
    res.json({ ok: true, channel: data.channel });
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