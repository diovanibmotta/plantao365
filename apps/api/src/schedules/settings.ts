import {
  DEFAULT_SHIFT_TIMES,
  SHIFT_DAY_TYPES,
  type LocalDate,
  type ShiftDayType,
  type ShiftException,
  type ShiftTime,
  type ShiftTimes,
  type WeekdayShiftTime,
  type WorkPeriod,
  parseLocalDate,
  sortWorkPeriods,
  validateWorkPeriods,
} from '@diovanibmotta/plantao365-shared';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { recordAudit } from '../audit/index.js';
import { requireRole } from '../auth/authz.js';
import type { AuthEnv } from '../auth/index.js';
import type { Sql } from '../db.js';
import type { Logger } from '../logger.js';
import {
  isImpactConfirmed,
  runScheduleImpact,
  type ScheduleImpact,
  type ScheduleImpactNotifier,
} from '../schedule-impact/index.js';

/** Horário configurado por tipo de dia; tipos sem linha usam o padrão. */
export async function getShiftTimes(sql: Sql, teamId: string): Promise<ShiftTimes> {
  const rows = await sql<{ dayType: ShiftDayType; startHour: number; endHour: number }[]>`
    select day_type as "dayType", start_hour as "startHour", end_hour as "endHour"
    from shift_settings where team_id = ${teamId}`;
  const times: ShiftTimes = { ...DEFAULT_SHIFT_TIMES };
  for (const r of rows) times[r.dayType] = { startHour: r.startHour, endHour: r.endHour };
  return times;
}

/** Exceções de horário no intervalo (inclusivo), em ordem de data; sem intervalo, todas. */
export async function listShiftExceptions(
  sql: Sql,
  teamId: string,
  range?: { from: LocalDate; to: LocalDate },
): Promise<ShiftException[]> {
  const from = range?.from ?? null;
  const to = range?.to ?? null;
  const rows = await sql<ShiftException[]>`
    select date::text as date, start_hour as "startHour", end_hour as "endHour",
      work_periods as "workPeriods", note
    from shift_exceptions
    where team_id = ${teamId}
      and (${from}::date is null or date >= ${from}::date)
      and (${to}::date is null or date <= ${to}::date)
    order by date`;
  return rows.map((r) => ({ ...r }));
}

/** Mapa data -> horário do plantão, para o contexto de cálculo/geração. */
export async function getShiftExceptionTimes(
  sql: Sql,
  teamId: string,
  from: LocalDate,
  to: LocalDate,
): Promise<Map<LocalDate, ShiftTime>> {
  const list = await listShiftExceptions(sql, teamId, { from, to });
  return new Map(list.map((e) => [e.date, { startHour: e.startHour, endHour: e.endHour }]));
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

/** Horários por dia da semana (1–5) da equipe, em ordem de dia. */
export async function listWeekdayTimes(sql: Sql, teamId: string): Promise<WeekdayShiftTime[]> {
  const rows = await sql<WeekdayShiftTime[]>`
    select weekday, start_hour as "startHour", end_hour as "endHour"
    from shift_weekday_times where team_id = ${teamId} order by weekday`;
  return rows.map((r) => ({ ...r }));
}

/** Mapa dia da semana -> horário do plantão, para o contexto de cálculo/geração. */
export async function getWeekdayTimes(sql: Sql, teamId: string): Promise<Map<number, ShiftTime>> {
  const list = await listWeekdayTimes(sql, teamId);
  return new Map(list.map((w) => [w.weekday, { startHour: w.startHour, endHour: w.endHour }]));
}

const toJson = (t: ShiftTimes) => Object.fromEntries(SHIFT_DAY_TYPES.map((k) => [k, { ...t[k] }]));

/** Jornada de trabalho da equipe, em ordem cronológica. */
export async function getWorkPeriods(sql: Sql, teamId: string): Promise<WorkPeriod[]> {
  const rows = await sql<{ startMinute: number; endMinute: number; name: string | null }[]>`
    select start_minute as "startMinute", end_minute as "endMinute", name
    from work_periods where team_id = ${teamId} order by position`;
  return rows.map((r) =>
    r.name
      ? { startMinute: r.startMinute, endMinute: r.endMinute, name: r.name }
      : { startMinute: r.startMinute, endMinute: r.endMinute },
  );
}

const minute = z
  .number({ error: 'Horário inválido' })
  .int('Horário inválido')
  .min(0, 'Horário deve estar entre 00:00 e 24:00')
  .max(1440, 'Horário deve estar entre 00:00 e 24:00');
const periodSchema = z
  .object({
    startMinute: minute,
    endMinute: minute,
    name: z.string().trim().max(60, 'Nome deve ter no máximo 60 caracteres').nullish(),
  })
  .strict();
/** Períodos em ordem cronológica, com o nome só quando preenchido. */
const normalizePeriods = (list: z.infer<typeof periodSchema>[]): WorkPeriod[] =>
  sortWorkPeriods(
    list.map((p) =>
      p.name
        ? { startMinute: p.startMinute, endMinute: p.endMinute, name: p.name }
        : { startMinute: p.startMinute, endMinute: p.endMinute },
    ),
  );
const workHoursBody = z.object({ periods: z.array(periodSchema) }).strict();

const weekdayNumber = z
  .number({ error: 'Dia da semana inválido' })
  .int('Dia da semana inválido')
  .min(0, 'Dia da semana inválido')
  .max(6, 'Dia da semana inválido');
const weekdayTimesBody = z
  .object({
    weekdays: z.array(weekdayNumber).default([]),
    holiday: z.boolean().default(false),
    startHour: hour,
    endHour: hour,
  })
  .strict()
  .refine((b) => b.weekdays.length > 0 || b.holiday, {
    message: 'Selecione ao menos um dia da semana ou feriado',
  });

const exceptionBody = z
  .object({
    startHour: hour,
    endHour: hour,
    workPeriods: z.array(periodSchema).nullable().default(null),
    note: z
      .string()
      .trim()
      .max(120, 'Observação deve ter no máximo 120 caracteres')
      .nullable()
      .default(null),
  })
  .strict();

const asLocalDate = (v: string | undefined): LocalDate | null => {
  if (!v) return null;
  try {
    return parseLocalDate(v) === v ? v : null;
  } catch {
    return null;
  }
};

const exceptionJson = (e: ShiftException) => ({
  ...e,
  workPeriods: e.workPeriods?.map((p) => ({ ...p })) ?? null,
});

const invalidDate = { error: 'validation_error', message: 'Data inválida; use AAAA-MM-DD' };

/** GET/PUT /shift-settings. Vale para escalas geradas depois; plantões existentes não mudam. */
export function registerSettingsRoutes(
  router: Hono<AuthEnv>,
  deps: {
    db: Sql;
    /** Regra core: avisa tela e gestores quando a mudança de horário atinge escala publicada. */
    scheduleImpactNotifier?: ScheduleImpactNotifier | undefined;
    logger?: Logger | undefined;
  },
): void {
  const { db, scheduleImpactNotifier, logger } = deps;
  const impactOf = (
    c: Context<AuthEnv>,
    tx: Sql,
    source: 'shift_times' | 'shift_exception',
    removed = false,
  ): Promise<ScheduleImpact | null> =>
    runScheduleImpact(
      tx,
      scheduleImpactNotifier,
      { source, teamId: c.get('teamId')!, actorId: c.get('user')!.id, removed },
      { logger, confirmed: isImpactConfirmed(c) },
    );
  const withImpact = (impact: ScheduleImpact | null) => (impact ? { scheduleImpact: impact } : {});
  router.get('/shift-settings', async (c) => c.json(await getShiftTimes(db, c.get('teamId')!)));

  router.get('/work-hours', async (c) =>
    c.json({ periods: (await getWorkPeriods(db, c.get('teamId')!)).map((p) => ({ ...p })) }),
  );

  router.put('/work-hours', requireRole('manager'), async (c) => {
    const parsed = workHoursBody.safeParse(await c.req.json().catch(() => null));
    const problem = parsed.success
      ? validateWorkPeriods(normalizePeriods(parsed.data.periods))
      : (parsed.error.issues[0]?.message ?? 'Dados inválidos');
    if (!parsed.success || problem) {
      return c.json({ error: 'validation_error', message: problem ?? 'Dados inválidos' }, 400);
    }
    const next = normalizePeriods(parsed.data.periods);
    const teamId = c.get('teamId')!;
    await db.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const before = await getWorkPeriods(tx, teamId);
      await tx`delete from work_periods where team_id = ${teamId}`;
      if (next.length > 0) {
        const rows = next.map((p, position) => ({
          team_id: teamId,
          position,
          start_minute: p.startMinute,
          end_minute: p.endMinute,
          name: p.name ?? null,
        }));
        await tx`insert into work_periods ${tx(rows)}`;
      }
      await recordAudit(tx, {
        actorId: c.get('user')!.id,
        action: 'work_hours.update',
        entityType: 'work_hours',
        entityId: null,
        before: { periods: before.map((p) => ({ ...p })) },
        after: { periods: next.map((p) => ({ ...p })) },
      });
    });
    return c.json({ periods: next });
  });

  router.get('/shift-weekday-times', async (c) =>
    c.json(await listWeekdayTimes(db, c.get('teamId')!)),
  );

  router.put('/shift-weekday-times', requireRole('manager'), async (c) => {
    const parsed = weekdayTimesBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        {
          error: 'validation_error',
          message: parsed.error.issues[0]?.message ?? 'Dados inválidos',
        },
        400,
      );
    }
    const { startHour, endHour, holiday } = parsed.data;
    const weekdays = [...new Set(parsed.data.weekdays)].sort((a, b) => a - b);
    const teamId = c.get('teamId')!;
    let impact: ScheduleImpact | null = null;
    await db.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const before = {
        weekdays: await listWeekdayTimes(tx, teamId),
        holiday: (await getShiftTimes(tx, teamId)).holiday,
      };
      if (weekdays.length > 0) {
        const rows = weekdays.map((weekday) => ({
          team_id: teamId,
          weekday,
          start_hour: startHour,
          end_hour: endHour,
        }));
        await tx`insert into shift_weekday_times ${tx(rows)}
          on conflict (team_id, weekday) do update set start_hour = excluded.start_hour,
            end_hour = excluded.end_hour, updated_at = now()`;
      }
      if (holiday) {
        await tx`insert into shift_settings (team_id, day_type, start_hour, end_hour)
          values (${teamId}, 'holiday', ${startHour}, ${endHour})
          on conflict (team_id, day_type) do update set start_hour = excluded.start_hour,
            end_hour = excluded.end_hour, updated_at = now()`;
      }
      await recordAudit(tx, {
        actorId: c.get('user')!.id,
        action: 'shift_weekday_times.update',
        entityType: 'shift_weekday_times',
        entityId: null,
        before: {
          weekdays: before.weekdays.map((w) => ({ ...w })),
          holiday: { ...before.holiday },
        },
        after: {
          weekdays: (await listWeekdayTimes(tx, teamId)).map((w) => ({ ...w })),
          holiday: { ...(await getShiftTimes(tx, teamId)).holiday },
        },
      });
      impact = await impactOf(c, tx, 'shift_times');
    });
    return c.json({ weekdays, holiday, startHour, endHour, ...withImpact(impact) });
  });

  router.delete('/shift-weekday-times', requireRole('manager'), async (c) => {
    const weekdays = (c.req.query('weekdays') ?? '')
      .split(',')
      .filter((v) => v.trim() !== '')
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6);
    if (weekdays.length === 0) {
      return c.json({ error: 'validation_error', message: 'Informe os dias da semana' }, 400);
    }
    const teamId = c.get('teamId')!;
    let impact: ScheduleImpact | null = null;
    const removed = await db.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const before = await listWeekdayTimes(tx, teamId);
      const gone = before.filter((w) => weekdays.includes(w.weekday));
      if (gone.length === 0) return false;
      await tx`delete from shift_weekday_times
        where team_id = ${teamId} and weekday in ${tx(weekdays)}`;
      await recordAudit(tx, {
        actorId: c.get('user')!.id,
        action: 'shift_weekday_times.delete',
        entityType: 'shift_weekday_times',
        entityId: null,
        before: gone.map((w) => ({ ...w })),
        after: null,
      });
      impact = await impactOf(c, tx, 'shift_times', true);
      return true;
    });
    if (!removed) return c.json({ error: 'not_found' }, 404);
    return impact ? c.json(withImpact(impact)) : c.body(null, 204);
  });

  router.get('/shift-exceptions', async (c) => {
    const teamId = c.get('teamId')!;
    const fromQ = c.req.query('from');
    const toQ = c.req.query('to');
    if (!fromQ && !toQ) return c.json(await listShiftExceptions(db, teamId));
    const from = asLocalDate(fromQ);
    const to = asLocalDate(toQ);
    if (!from || !to) return c.json(invalidDate, 400);
    return c.json(await listShiftExceptions(db, teamId, { from, to }));
  });

  router.put('/shift-exceptions/:date', requireRole('manager'), async (c) => {
    const date = asLocalDate(c.req.param('date'));
    if (!date) return c.json(invalidDate, 400);
    const parsed = exceptionBody.safeParse(await c.req.json().catch(() => null));
    const problem = parsed.success
      ? parsed.data.workPeriods
        ? validateWorkPeriods(normalizePeriods(parsed.data.workPeriods))
        : null
      : (parsed.error.issues[0]?.message ?? 'Dados inválidos');
    if (!parsed.success || problem) {
      return c.json({ error: 'validation_error', message: problem ?? 'Dados inválidos' }, 400);
    }
    const { startHour, endHour, note } = parsed.data;
    const workPeriods = parsed.data.workPeriods ? normalizePeriods(parsed.data.workPeriods) : null;
    const teamId = c.get('teamId')!;
    const saved: ShiftException = { date, startHour, endHour, workPeriods, note: note || null };
    let impact: ScheduleImpact | null = null;
    await db.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const [before] = await listShiftExceptions(tx, teamId, { from: date, to: date });
      await tx`insert into shift_exceptions (team_id, date, start_hour, end_hour, work_periods, note)
        values (${teamId}, ${date}::date, ${startHour}, ${endHour},
          ${workPeriods ? tx.json(workPeriods) : null}, ${saved.note})
        on conflict (team_id, date) do update set start_hour = excluded.start_hour,
          end_hour = excluded.end_hour, work_periods = excluded.work_periods,
          note = excluded.note, updated_at = now()`;
      await recordAudit(tx, {
        actorId: c.get('user')!.id,
        action: before ? 'shift_exception.update' : 'shift_exception.create',
        entityType: 'shift_exception',
        entityId: null,
        before: before ? exceptionJson(before) : null,
        after: exceptionJson(saved),
      });
      impact = await impactOf(c, tx, 'shift_exception');
    });
    return c.json({ ...saved, ...withImpact(impact) });
  });

  router.delete('/shift-exceptions/:date', requireRole('manager'), async (c) => {
    const date = asLocalDate(c.req.param('date'));
    if (!date) return c.json(invalidDate, 400);
    const teamId = c.get('teamId')!;
    let impact: ScheduleImpact | null = null;
    const removed = await db.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const [before] = await listShiftExceptions(tx, teamId, { from: date, to: date });
      if (!before) return false;
      await tx`delete from shift_exceptions where team_id = ${teamId} and date = ${date}::date`;
      await recordAudit(tx, {
        actorId: c.get('user')!.id,
        action: 'shift_exception.delete',
        entityType: 'shift_exception',
        entityId: null,
        before: exceptionJson(before),
        after: null,
      });
      impact = await impactOf(c, tx, 'shift_exception', true);
      return true;
    });
    if (!removed) return c.json({ error: 'not_found' }, 404);
    return impact ? c.json(withImpact(impact)) : c.body(null, 204);
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
    const teamId = c.get('teamId')!;
    let impact: ScheduleImpact | null = null;
    await db.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const before = await getShiftTimes(tx, teamId);
      const rows = SHIFT_DAY_TYPES.map((t) => ({
        team_id: teamId,
        day_type: t,
        start_hour: next[t].startHour,
        end_hour: next[t].endHour,
      }));
      await tx`insert into shift_settings ${tx(rows)}
        on conflict (team_id, day_type) do update set start_hour = excluded.start_hour,
          end_hour = excluded.end_hour, updated_at = now()`;
      await recordAudit(tx, {
        actorId: c.get('user')!.id,
        action: 'shift_settings.update',
        entityType: 'shift_settings',
        entityId: null,
        before: toJson(before),
        after: toJson(next),
      });
      impact = await impactOf(c, tx, 'shift_times');
    });
    return c.json({ ...next, ...withImpact(impact) });
  });
}
