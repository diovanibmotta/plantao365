import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { recordAudit } from '../audit/index.js';
import { requireAuth, requireRole, type AuthEnv } from '../auth/index.js';
import type { Sql } from '../db.js';
import type { Logger } from '../logger.js';
import {
  isImpactConfirmed,
  runScheduleImpact,
  type ScheduleImpact,
  type ScheduleImpactNotifier,
} from '../schedule-impact/index.js';
import {
  createHolidaySchema,
  holidayFiltersSchema,
  listHolidays,
  noImpact,
  toDto,
  updateHolidaySchema,
  type HolidayDto,
  type HolidayRow,
  type HolidayWarning,
  type ImpactChecker,
} from './service.js';
import {
  recalculateBodySchema,
  recalculateHolidayShifts,
  type ShiftsRecalculatedHook,
} from './recalc.js';

export interface HolidaysRouterDeps {
  db: Sql;
  impactChecker?: ImpactChecker;
  onShiftsRecalculated?: ShiftsRecalculatedHook | undefined;
  /** Regra core: aviso em tela e e-mail ao gestor quando o feriado atinge escala publicada. */
  scheduleImpactNotifier?: ScheduleImpactNotifier | undefined;
  logger?: Logger | undefined;
}

const idSchema = z.uuid();

function validationError(error: z.ZodError) {
  return { error: 'validation_error', details: error.issues.map((i) => i.message) };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export function createHolidaysRouter({
  db,
  impactChecker = noImpact,
  onShiftsRecalculated,
  scheduleImpactNotifier,
  logger,
}: HolidaysRouterDeps): Hono<AuthEnv> {
  const router = new Hono<AuthEnv>();
  const manager = requireRole('manager');

  const impactOf = (
    c: Context,
    tx: Sql,
    dates: string[],
    actorId: string,
    removed = false,
  ): Promise<ScheduleImpact | null> =>
    runScheduleImpact(
      tx,
      scheduleImpactNotifier,
      { source: 'holiday', actorId, dates, removed },
      { logger, confirmed: isImpactConfirmed(c) },
    );

  async function warningsFor(dates: string[]): Promise<HolidayWarning[]> {
    const unique = [...new Set(dates)].sort();
    const impacts = await impactChecker(db, unique);
    return impacts
      .filter((i) => i.count > 0)
      .map((i) => ({ type: 'published_shifts_affected' as const, date: i.date, count: i.count }));
  }

  router.get('/holidays', requireAuth(), async (c) => {
    const parsed = holidayFiltersSchema.safeParse(c.req.query());
    if (!parsed.success) return c.json(validationError(parsed.error), 400);
    return c.json({ items: await listHolidays(db, parsed.data) });
  });

  router.get('/holidays/:id', requireAuth(), async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    const [row] = await db<HolidayRow[]>`
      select id, date::text as date, name, scope from holidays where id = ${id.data}`;
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json(toDto(row));
  });

  router.post('/holidays', manager, async (c) => {
    const parsed = createHolidaySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(validationError(parsed.error), 400);
    const actor = c.get('user')!;
    const { date, name, scope } = parsed.data;
    let created: { dto: HolidayDto; impact: ScheduleImpact | null };
    try {
      created = await db.begin(async (tx) => {
        const [row] = await tx<HolidayRow[]>`
          insert into holidays (date, name, scope) values (${date}::date, ${name}, ${scope})
          returning id, date::text as date, name, scope`;
        const dto = toDto(row!);
        await recordAudit(tx, {
          actorId: actor.id,
          action: 'create',
          entityType: 'holiday',
          entityId: dto.id,
          after: { ...dto },
        });
        return { dto, impact: await impactOf(c, tx as unknown as Sql, [dto.date], actor.id) };
      });
    } catch (err) {
      if (isUniqueViolation(err)) return c.json({ error: 'duplicate_holiday' }, 409);
      throw err;
    }
    return c.json(
      {
        ...created.dto,
        warnings: await warningsFor([created.dto.date]),
        ...(created.impact && { scheduleImpact: created.impact }),
      },
      201,
    );
  });

  router.patch('/holidays/:id', manager, async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    const parsed = updateHolidaySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(validationError(parsed.error), 400);
    const actor = c.get('user')!;
    const patch = parsed.data;
    let result: {
      before: HolidayDto;
      after: HolidayDto;
      impact: ScheduleImpact | null;
    } | null;
    try {
      result = await db.begin(async (tx) => {
        const [current] = await tx<HolidayRow[]>`
          select id, date::text as date, name, scope from holidays
          where id = ${id.data} for update`;
        if (!current) return null;
        const before = toDto(current);
        const next = {
          date: patch.date ?? before.date,
          name: patch.name ?? before.name,
          scope: patch.scope ?? before.scope,
        };
        const [row] = await tx<HolidayRow[]>`
          update holidays
          set date = ${next.date}::date, name = ${next.name}, scope = ${next.scope},
            updated_at = now()
          where id = ${id.data}
          returning id, date::text as date, name, scope`;
        const after = toDto(row!);
        await recordAudit(tx, {
          actorId: actor.id,
          action: 'update',
          entityType: 'holiday',
          entityId: after.id,
          before: { ...before },
          after: { ...after },
        });
        // só a data muda o cálculo dos plantões; nome e abrangência não
        const impact =
          before.date === after.date
            ? null
            : await impactOf(c, tx as unknown as Sql, [before.date, after.date], actor.id);
        return { before, after, impact };
      });
    } catch (err) {
      if (isUniqueViolation(err)) return c.json({ error: 'duplicate_holiday' }, 409);
      throw err;
    }
    if (!result) return c.json({ error: 'not_found' }, 404);
    const warnings = await warningsFor([result.before.date, result.after.date]);
    return c.json({
      ...result.after,
      warnings,
      ...(result.impact && { scheduleImpact: result.impact }),
    });
  });

  router.delete('/holidays/:id', manager, async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    const actor = c.get('user')!;
    const removed = await db.begin(async (tx) => {
      const [row] = await tx<HolidayRow[]>`
        delete from holidays where id = ${id.data}
        returning id, date::text as date, name, scope`;
      if (!row) return null;
      const dto = toDto(row);
      await recordAudit(tx, {
        actorId: actor.id,
        action: 'delete',
        entityType: 'holiday',
        entityId: dto.id,
        before: { ...dto },
      });
      return {
        dto,
        impact: await impactOf(c, tx as unknown as Sql, [dto.date], actor.id, true),
      };
    });
    if (!removed) return c.json({ error: 'not_found' }, 404);
    return c.json({
      ...removed.dto,
      warnings: await warningsFor([removed.dto.date]),
      ...(removed.impact && { scheduleImpact: removed.impact }),
    });
  });

  router.post('/holidays/recalculate', manager, async (c) => {
    const parsed = recalculateBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(validationError(parsed.error), 400);
    const changes = await recalculateHolidayShifts(
      db,
      { dates: parsed.data.dates, actorId: c.get('user')!.id },
      onShiftsRecalculated,
    );
    return c.json({ updated: changes.length, changes });
  });

  return router;
}
