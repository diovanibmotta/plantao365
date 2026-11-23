import { Hono } from 'hono';
import { z } from 'zod';
import { recordAudit } from '../audit/index.js';
import { requireRole, type AuthEnv } from '../auth/index.js';
import type { Sql } from '../db.js';
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
}: HolidaysRouterDeps): Hono<AuthEnv> {
  const router = new Hono<AuthEnv>();
  const manager = requireRole('manager');

  async function warningsFor(dates: string[]): Promise<HolidayWarning[]> {
    const unique = [...new Set(dates)].sort();
    const impacts = await impactChecker(db, unique);
    return impacts
      .filter((i) => i.count > 0)
      .map((i) => ({ type: 'published_shifts_affected' as const, date: i.date, count: i.count }));
  }

  router.get('/holidays', requireRole('member'), async (c) => {
    const parsed = holidayFiltersSchema.safeParse(c.req.query());
    if (!parsed.success) return c.json(validationError(parsed.error), 400);
    return c.json({ items: await listHolidays(db, parsed.data) });
  });

  router.post('/holidays', manager, async (c) => {
    const parsed = createHolidaySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(validationError(parsed.error), 400);
    const actor = c.get('user')!;
    const { date, name, scope } = parsed.data;
    let created: HolidayDto;
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
        return dto;
      });
    } catch (err) {
      if (isUniqueViolation(err)) return c.json({ error: 'duplicate_holiday' }, 409);
      throw err;
    }
    return c.json({ ...created, warnings: await warningsFor([created.date]) }, 201);
  });

  router.patch('/holidays/:id', manager, async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    const parsed = updateHolidaySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(validationError(parsed.error), 400);
    const actor = c.get('user')!;
    const patch = parsed.data;
    let result: { before: HolidayDto; after: HolidayDto } | null;
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
        return { before, after };
      });
    } catch (err) {
      if (isUniqueViolation(err)) return c.json({ error: 'duplicate_holiday' }, 409);
      throw err;
    }
    if (!result) return c.json({ error: 'not_found' }, 404);
    const warnings = await warningsFor([result.before.date, result.after.date]);
    return c.json({ ...result.after, warnings });
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
      return dto;
    });
    if (!removed) return c.json({ error: 'not_found' }, 404);
    return c.json({ ...removed, warnings: await warningsFor([removed.date]) });
  });

  router.post('/holidays/recalculate', manager, async (c) => {
    const parsed = recalculateBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(validationError(parsed.error), 400);
    const changes = await recalculateHolidayShifts(db, {
      dates: parsed.data.dates,
      actorId: c.get('user')!.id,
    });
    if (changes.length > 0 && onShiftsRecalculated) {
      try {
        await onShiftsRecalculated(changes);
      } catch {
        // falha de notificação não desfaz o recálculo já commitado
      }
    }
    return c.json({ updated: changes.length, changes });
  });

  return router;
}
