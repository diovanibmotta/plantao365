import {
  DEFAULT_SHIFT_TIMES,
  SHIFT_DAY_TYPES,
  type ShiftDayType,
  type ShiftTimes,
  type WorkPeriod,
  validateWorkPeriods,
} from '@diovanibmotta/plantao365-shared';
import type { Hono } from 'hono';
import { z } from 'zod';
import { recordAudit } from '../audit/index.js';
import { requireRole } from '../auth/authz.js';
import type { AuthEnv } from '../auth/index.js';
import type { Sql } from '../db.js';

/** Horário configurado por tipo de dia; tipos sem linha usam o padrão. */
export async function getShiftTimes(sql: Sql): Promise<ShiftTimes> {
  const rows = await sql<{ dayType: ShiftDayType; startHour: number; endHour: number }[]>`
    select day_type as "dayType", start_hour as "startHour", end_hour as "endHour"
    from shift_settings`;
  const times: ShiftTimes = { ...DEFAULT_SHIFT_TIMES };
  for (const r of rows) times[r.dayType] = { startHour: r.startHour, endHour: r.endHour };
  return times;
}

const hour = z
  .number({ error: 'Hora inválida' })
  .int('Hora deve ser inteira')
  .min(0, 'Hora deve estar entre 0 e 23')
  .max(23, 'Hora deve estar entre 0 e 23');
const time = z.object({ startHour: hour, endHour: hour }).strict();
const putBody = z
  .object(
    Object.fromEntries(SHIFT_DAY_TYPES.map((t) => [t, time])) as Record<ShiftDayType, typeof time>,
  )
  .strict();

const toJson = (t: ShiftTimes) => Object.fromEntries(SHIFT_DAY_TYPES.map((k) => [k, { ...t[k] }]));

/** Jornada de trabalho do time, em ordem cronológica. */
export async function getWorkPeriods(sql: Sql): Promise<WorkPeriod[]> {
  return sql<WorkPeriod[]>`
    select start_minute as "startMinute", end_minute as "endMinute"
    from work_periods order by position`;
}

const minute = z
  .number({ error: 'Horário inválido' })
  .int('Horário inválido')
  .min(0, 'Horário deve estar entre 00:00 e 24:00')
  .max(1440, 'Horário deve estar entre 00:00 e 24:00');
const workHoursBody = z
  .object({
    periods: z.array(z.object({ startMinute: minute, endMinute: minute }).strict()),
  })
  .strict();

/** GET/PUT /shift-settings. Vale para escalas geradas depois; plantões existentes não mudam. */
export function registerSettingsRoutes(router: Hono<AuthEnv>, deps: { db: Sql }): void {
  const { db } = deps;
  router.get('/shift-settings', async (c) => c.json(await getShiftTimes(db)));

  router.get('/work-hours', async (c) =>
    c.json({ periods: (await getWorkPeriods(db)).map((p) => ({ ...p })) }),
  );

  router.put('/work-hours', requireRole('manager'), async (c) => {
    const parsed = workHoursBody.safeParse(await c.req.json().catch(() => null));
    const problem = parsed.success
      ? validateWorkPeriods(parsed.data.periods)
      : (parsed.error.issues[0]?.message ?? 'Dados inválidos');
    if (!parsed.success || problem) {
      return c.json({ error: 'validation_error', message: problem ?? 'Dados inválidos' }, 400);
    }
    const next = parsed.data.periods;
    await db.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const before = await getWorkPeriods(tx);
      await tx`delete from work_periods`;
      if (next.length > 0) {
        const rows = next.map((p, position) => ({
          position,
          start_minute: p.startMinute,
          end_minute: p.endMinute,
        }));
        await tx`insert into work_periods ${tx(rows)}`;
      }
      await recordAudit(tx, {
        actorId: c.get('user')!.id,
        action: 'work_hours.update',
        entityType: 'work_hours',
        entityId: null,
        before: { periods: before.map((p) => ({ ...p })) },
        after: { periods: next },
      });
    });
    return c.json({ periods: next });
  });

  router.put('/shift-settings', requireRole('manager'), async (c) => {
    const parsed = putBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        {
          error: 'validation_error',
          message: parsed.error.issues[0]?.message ?? 'Dados inválidos',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        400,
      );
    }
    const next = parsed.data;
    await db.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const before = await getShiftTimes(tx);
      const rows = SHIFT_DAY_TYPES.map((t) => ({
        day_type: t,
        start_hour: next[t].startHour,
        end_hour: next[t].endHour,
      }));
      await tx`insert into shift_settings ${tx(rows)}
        on conflict (day_type) do update set start_hour = excluded.start_hour,
          end_hour = excluded.end_hour, updated_at = now()`;
      await recordAudit(tx, {
        actorId: c.get('user')!.id,
        action: 'shift_settings.update',
        entityType: 'shift_settings',
        entityId: null,
        before: toJson(before),
        after: toJson(next),
      });
    });
    return c.json(next);
  });
}
