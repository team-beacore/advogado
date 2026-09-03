import { Router } from 'express';
import { requireAuth, requireOrg, getOrgId, requirePermission } from '../auth/middleware';
import { PERMISSIONS } from '@advogado/shared';
import { getPool } from '../db/client';
import { getMonitorStatus, staleThresholdMinutes } from '../capture/scheduler/service';

const router = Router();

router.use(requireAuth, requireOrg);

/**
 * Status técnico do monitoramento da instalação (somente agregados; sem dados
 * jurídicos individuais). Acesso: quem possui PROCESSES_READ. FINANCE não recebe.
 *
 * Retorna:
 *  - scheduler: estado global do scheduler (enabled/running/ciclos em memória);
 *  - organization: contagens agregadas (ativos/pausados/erro/atrasados);
 *  - NUNCA retorna API keys, tokens, senhas ou credenciais.
 */
router.get('/status', requirePermission(PERMISSIONS.PROCESSES_READ), async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const scheduler = getMonitorStatus();
    const staleAfterMinutes = staleThresholdMinutes();
    const pool = getPool();
    const aggRes = await pool.query(
      `SELECT
         count(*) FILTER (WHERE monitoring_status = 'ACTIVE') AS active,
         count(*) FILTER (WHERE monitoring_status = 'PAUSED') AS paused,
         count(*) FILTER (WHERE monitoring_status = 'ERROR') AS error,
         count(*) FILTER (
           WHERE monitoring_status = 'ACTIVE'
             AND process_number IS NOT NULL AND process_number <> ''
             AND last_synced_at IS NOT NULL
             AND last_synced_at <= now() - ($1 || ' minutes')::interval
             AND (last_sync_error IS NULL OR last_sync_error = '')
         ) AS stale
       FROM cases WHERE organization_id = $2`,
      [staleAfterMinutes, orgId],
    );
    const agg = aggRes.rows[0] ?? { active: 0, paused: 0, error: 0, stale: 0 };
    const runsRes = await pool.query(
      `SELECT count(*)::int AS total_syncs,
              COALESCE(sum(imported_count)::int, 0) AS total_events
       FROM capture_runs WHERE organization_id = $1 AND adapter = 'SYNC'`,
      [orgId],
    );
    res.json({
      scheduler,
      staleAfterMinutes,
      organization: {
        active: Number(agg.active ?? 0),
        paused: Number(agg.paused ?? 0),
        error: Number(agg.error ?? 0),
        stale: Number(agg.stale ?? 0),
        totalSyncs: runsRes.rows[0]?.total_syncs ?? 0,
        totalEvents: runsRes.rows[0]?.total_events ?? 0,
      },
    });
  } catch (err) { next(err); }
});

export default router;
