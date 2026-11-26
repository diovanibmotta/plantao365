import { Hono } from 'hono';
import type { ZodError } from 'zod';
import { requireAuth } from '../auth/authz.js';
import type { AuthEnv } from '../auth/index.js';
import type { Sql } from '../db.js';
import type { Logger } from '../logger.js';
import {
  assessScheduleConflicts,
  assessShiftConflicts,
  type ScheduleImpactNotifier,
} from '../schedule-impact/index.js';
import { requireTeam } from '../teams/middleware.js';
import { registerEditRoutes, type ShiftChangedHook } from './edit.js';
import { registerGenerateRoute, type RotationAdjustersProvider } from './generate.js';
import { registerPublishRoutes, type PublishedHook } from './publish.js';
import { registerSettingsRoutes } from './settings.js';
import {
  getSchedule,
  listSchedules,
  listShiftsInRange,
  listShiftsOfSchedule,
  myShiftsQuerySchema,
  shiftsQuerySchema,
} from './service.js';

export interface SchedulesRouterDeps {
  db: Sql;
  now?: () => Date;
  /** Task 9.2: notifica após alteração de plantão em escala publicada. */
  onShiftChanged?: ShiftChangedHook;
  /** Task 9.2: notifica após a publicação de uma escala. */
  onPublished?: PublishedHook;
  /** Regra core: avisa tela e gestores quando horários configurados atingem escala publicada. */
  scheduleImpactNotifier?: ScheduleImpactNotifier;
  /** Ajustes de regra de plugins aplicados na geração da escala. */
  rotationAdjusters?: RotationAdjustersProvider;
  logger?: Logger;
}

const invalid = (error: ZodError) => ({
  error: 'invalid_filters',
  message: 'Filtros inválidos',
  issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
});

export function createSchedulesRouter({
  db,
  now,
  onShiftChanged,
  onPublished,
  scheduleImpactNotifier,
  rotationAdjusters,
  logger,
}: SchedulesRouterDeps): Hono<AuthEnv> {
  const router = new Hono<AuthEnv>();
  router.use('*', requireAuth(), requireTeam());

  registerGenerateRoute(router, { db, now, rotationAdjusters });
  registerPublishRoutes(router, { db, now, onPublished });
  registerEditRoutes(router, { db, onShiftChanged });
  registerSettingsRoutes(router, { db, scheduleImpactNotifier, logger });

  router.get('/schedules', async (c) => {
    const isManager = c.get('user')!.role === 'manager';
    const teamId = c.get('teamId')!;
    const schedules = await listSchedules(db, { publishedOnly: !isManager, teamId });
    if (!isManager) return c.json(schedules);
    const conflicts = await assessScheduleConflicts(
      db,
      teamId,
      schedules.map((s) => s.id),
    );
    return c.json(schedules.map((s) => ({ ...s, conflicts: conflicts.get(s.id)! })));
  });

  router.get('/schedules/:id', async (c) => {
    const isManager = c.get('user')!.role === 'manager';
    const schedule = await getSchedule(db, c.req.param('id'), c.get('teamId')!);
    if (!schedule || (!isManager && schedule.status !== 'published')) {
      return c.json({ error: 'not_found', message: 'Escala não encontrada' }, 404);
    }
    const shifts = await listShiftsOfSchedule(db, schedule.id);
    if (!isManager) return c.json({ ...schedule, shifts });
    const conflicts = await assessShiftConflicts(db, c.get('teamId')!, schedule.id);
    return c.json({
      ...schedule,
      shifts: shifts.map((s) => ({ ...s, conflicts: conflicts.get(s.id) ?? [] })),
    });
  });

  router.get('/shifts/mine', async (c) => {
    const parsed = myShiftsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const shifts = await listShiftsInRange(db, {
      ...parsed.data,
      status: 'published',
      userId: c.get('user')!.id,
      teamId: c.get('teamId')!,
    });
    return c.json(shifts);
  });

  router.get('/shifts', async (c) => {
    const parsed = shiftsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const isManager = c.get('user')!.role === 'manager';
    const status = parsed.data.status ?? 'published';
    if (!isManager && status !== 'published') {
      return c.json(
        { error: 'forbidden', message: 'Apenas gestores acessam escalas em rascunho' },
        403,
      );
    }
    return c.json(
      await listShiftsInRange(db, { ...parsed.data, status, teamId: c.get('teamId')! }),
    );
  });

  return router;
}
