import express, { type NextFunction, type Request, type Response } from 'express';
import authRoutes from './routes/auth';
import organizationRoutes from './routes/organizations';
import clientRoutes from './routes/clients';
import processRoutes from './routes/processes';
import documentRoutes from './routes/documents';
import taskRoutes from './routes/tasks';
import publicationRoutes from './routes/publications';
import leadRoutes from './routes/leads';
import notificationRoutes from './routes/notifications';
import aiRoutes from './routes/ai';
import auditRoutes from './routes/audit';
import dashboardRoutes from './routes/dashboard';
import settingsRoutes from './routes/settings';
import financeRoutes from './routes/finance';
import captureRoutes from './routes/capture';
import portalRoutes from './routes/portal';
import superAdminRoutes from './routes/superadmin';
import { requireAuth } from './auth/middleware';
import { getEnv } from './config';
import { getPool } from './db/client';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '5mb' }));
  app.disable('x-powered-by');

  // CORS for local dev
  app.use((_req, res, next) => {
    const env = getEnv();
    res.setHeader('Access-Control-Allow-Origin', env.CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Switch organization — needs req.user set
  app.post('/api/auth/switch-org', requireAuth, async (req, res, next) => {
    try {
      const { organizationId } = req.body;
      if (!organizationId) {
        res.status(400).json({ code: 'VALIDATION', message: 'organizationId é obrigatório.' });
        return;
      }
      const pool = getPool();
      const memberRes = await pool.query(
        'SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2',
        [organizationId, req.user!.id],
      );
      if (memberRes.rows.length === 0) {
        res.status(403).json({ code: 'FORBIDDEN', message: 'Você não pertence a esta organização.' });
        return;
      }
      await pool.query('UPDATE sessions SET organization_id = $1 WHERE id = $2', [organizationId, req.user!.sessionId]);
      res.json({ organizationId, role: memberRes.rows[0].role });
    } catch (err) { next(err); }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/organizations', organizationRoutes);
  app.use('/api/clients', clientRoutes);
  app.use('/api/processes', processRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/publications', publicationRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/finance', financeRoutes);
  app.use('/api/capture', captureRoutes);
  app.use('/api/portal', portalRoutes);
  app.use('/api/superadmin', superAdminRoutes);

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    // Map known PostgreSQL errors
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ code: 'CONFLICT', message: 'Registro duplicado. Este identificador já está em uso nesta organização.' });
      return;
    }
    if ((err as { code?: string }).code === '23503') {
      res.status(400).json({ code: 'VALIDATION', message: 'Referência inválida para um recurso relacionado.' });
      return;
    }
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as { code?: string }).code ?? 'INTERNAL';
    const message = status === 500 ? 'Erro interno do servidor.' : err.message;
    if (status === 500) {
      console.error('Unhandled error:', err);
    }
    res.status(status).json({ code, message });
  });

  return app;
}