import {
  addDays,
  generateRotation,
  parseLocalDate,
  shiftForDate,
  type LocalDate,
  type RotationAdjuster,
  type RotationMember,
  type RotationOutput,
  type ShiftContext,
} from '@diovanibmotta/plantao365-shared';
import type { Hono } from 'hono';
import { z } from 'zod';
import { recordAudit } from '../audit/index.js';
import { publishEvent } from '../events/publisher.js';
import { requireRole } from '../auth/authz.js';
import type { AuthEnv } from '../auth/index.js';
import { listActualHoursByUser } from '../balance/index.js';
import type { Sql } from '../db.js';
import { listHolidayDates } from '../holidays/service.js';
import { listPreferences } from '../preferences/service.js';
import { listUnavailableByDate } from '../unavailability/service.js';
import { MAX_RANGE_DAYS, getSchedule, listShiftsOfSchedule } from './service.js';
import { getShiftExceptionTimes, getShiftTimes, getWeekdayTimes } from './settings.js';
import type { ScheduleDto, ShiftDto } from './types.js';

/** Início do histórico de horas realizadas (anterior a qualquer dado possível). */
const HISTORY_START: LocalDate = '2000-01-01';
/** Dias anteriores ao período usados em lastAssignments (acima do máximo de consecutivos). */
const LAST_ASSIGNMENTS_DAYS = 14;

const localDate = z.string().refine(
  (v) => {
    try {
      return parseLocalDate(v) === v;
    } catch {
      return false;
    }
  },
  { message: 'Data inválida; use AAAA-MM-DD' },
);

export const generateBodySchema = z
  .object({ from: localDate, to: localDate })
  .refine((b) => b.from <= b.to, {
    message: 'from deve ser anterior ou igual a to',
    path: ['from'],
  })
  .refine((b) => (Date.parse(b.to) - Date.parse(b.from)) / 86_400_000 < MAX_RANGE_DAYS, {
    message: `O período máximo é de ${MAX_RANGE_DAYS} dias`,
    path: ['to'],
  });

export type GenerateBody = z.infer<typeof generateBodySchema>;

export interface GenerateResult {
  schedule: ScheduleDto;
  shifts: ShiftDto[];
  unassignedDates: RotationOutput['unassignedDates'];
  preferenceViolations: RotationOutput['preferenceViolations'];
  summary: RotationOutput['summary'];
}

export class ScheduleOverlapError extends Error {
  constructor(readonly scheduleId: string) {
    super('O período se sobrepõe a um rascunho existente');
  }
}

/**
 * Histórico para o equilíbrio: horas realizadas (plantões encerrados + ajustes, via balance) e
 * contagem de plantões encerrados de fim de semana/feriado (day_type 'weekend' | 'holiday').
 * Ajustes são só em horas e não entram na contagem de fins de semana/feriados.
 * Considera apenas datas anteriores ao período, para não contar em dobro o que será gerado.
 */
async function loadHistory(
  sql: Sql,
  before: LocalDate,
  now: Date,
): Promise<{ hours: Map<string, number>; special: Map<string, number> }> {
  const to = addDays(before, -1);
  const hours = await listActualHoursByUser(sql, { from: HISTORY_START, to, now });
  const rows = await sql<{ userId: string; n: number }[]>`
    select s.user_id as "userId", count(*)::int as n
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.status = 'published' and s.user_id is not null
      and s.day_type in ('weekend', 'holiday')
      and s.date between ${HISTORY_START}::date and ${to}::date
      and s.ends_at <= ${now.toISOString()}::timestamptz
    group by 1`;
  return { hours, special: new Map(rows.map((r) => [r.userId, r.n])) };
}

/** Plantões publicados da equipe logo antes do período (outra equipe tem o próprio rodízio). */
async function loadLastAssignments(sql: Sql, from: LocalDate, teamId: string) {
  return sql<{ date: LocalDate; userId: string }[]>`
    select s.date::text as date, s.user_id as "userId"
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.status = 'published' and sc.team_id = ${teamId} and s.user_id is not null
      and s.date between ${addDays(from, -LAST_ASSIGNMENTS_DAYS)}::date
        and ${addDays(from, -1)}::date
    order by s.date`;
}

/** Gera o rascunho dentro da transação `tx`; lança ScheduleOverlapError se houver sobreposição. */
/**
 * Ponto de extensão: devolve ajustes de regra (plugins) para a geração, carregados na transação
 * antes do motor puro rodar. Falhas devem ser tratadas por quem fornece (a geração não para).
 */
export type RotationAdjustersProvider = (
  tx: Sql,
  ctx: { teamId: string; from: LocalDate; to: LocalDate; memberIds: string[] },
) => Promise<RotationAdjuster[]>;

export async function generateDraft(
  tx: Sql,
  input: {
    body: GenerateBody;
    actorId: string;
    now: Date;
    teamId: string;
    rotationAdjusters?: RotationAdjustersProvider | undefined;
  },
): Promise<GenerateResult> {
  const { from, to } = input.body;
  const { teamId } = input;
  // Serializa gerações concorrentes para que a checagem de sobreposição seja confiável.
  await tx`select pg_advisory_xact_lock(hashtext('schedules.generate'))`;
  const [overlap] = await tx<{ id: string }[]>`
    select id from schedules
    where status = 'draft' and team_id = ${teamId}
      and start_date <= ${to}::date and end_date >= ${from}::date
    limit 1`;
  if (overlap) throw new ScheduleOverlapError(overlap.id);

  const holidays = await listHolidayDates(tx, from, to);
  const unavailable = await listUnavailableByDate(tx, from, to, teamId);
  const users = await tx<{ id: string; name: string; active: boolean; participates: boolean }[]>`
    select u.id, u.name, u.active, m.participates_in_rotation as participates
    from users u join team_members m on m.user_id = u.id and m.team_id = ${teamId}
    where u.active and m.participates_in_rotation order by u.id`;
  const history = await loadHistory(tx, from, input.now);
  const lastAssignments = await loadLastAssignments(tx, from, teamId);
  const preferences = await listPreferences(
    tx,
    users.map((u) => u.id),
  );

  const shiftContext: ShiftContext = {
    holidays,
    collectiveVacations: unavailable.collectiveVacations,
    shiftTimes: await getShiftTimes(tx, teamId),
    weekdayTimes: await getWeekdayTimes(tx, teamId),
    shiftExceptions: await getShiftExceptionTimes(tx, teamId, from, to),
  };
  const members: RotationMember[] = users.map((u) => {
    const prefs = preferences.get(u.id);
    return {
      id: u.id,
      name: u.name,
      active: u.active,
      participatesInRotation: u.participates,
      unavailableDates: unavailable.byUser.get(u.id) ?? [],
      preferences: {
        avoidWeekdays: prefs?.avoidWeekdays ?? [],
        maxConsecutiveShifts: prefs?.maxConsecutiveShifts ?? null,
      },
      history: {
        hoursDone: history.hours.get(u.id) ?? 0,
        weekendHolidayShiftsDone: history.special.get(u.id) ?? 0,
      },
    };
  });

  const adjusters = input.rotationAdjusters
    ? await input.rotationAdjusters(tx, { teamId, from, to, memberIds: users.map((u) => u.id) })
    : [];
  const result = generateRotation({
    from,
    to,
    shiftContext,
    members,
    lastAssignments,
    adjusters,
  });

  const [created] = await tx<{ id: string }[]>`
    insert into schedules (start_date, end_date, status, created_by, team_id)
    values (${from}::date, ${to}::date, 'draft', ${input.actorId}, ${teamId})
    returning id`;
  const scheduleId = created!.id;

  // original_user_id/original_hours ficam nulos: são gravados na publicação (task 6.4).
  const rows = result.shifts.map((s) => {
    const times = shiftForDate(s.date, shiftContext);
    return {
      schedule_id: scheduleId,
      date: s.date,
      day_type: s.dayType,
      hours: s.hours,
      starts_at: times.start?.toISOString() ?? null,
      ends_at: times.end?.toISOString() ?? null,
      user_id: s.userId,
    };
  });
  await tx`insert into shifts ${tx(rows)}`;

  await recordAudit(tx, {
    actorId: input.actorId,
    action: 'schedule.generate',
    entityType: 'schedule',
    entityId: scheduleId,
    after: {
      from,
      to,
      shifts: rows.length,
      unassignedDates: result.unassignedDates.length,
      preferenceViolations: result.preferenceViolations.length,
    },
  });

  await publishEvent(tx, 'schedule.generated', {
    scheduleId,
    teamId,
    startDate: from,
    endDate: to,
    actorId: input.actorId,
    shifts: rows.length,
    unassignedDates: result.unassignedDates.length,
  });

  return {
    schedule: (await getSchedule(tx, scheduleId))!,
    shifts: await listShiftsOfSchedule(tx, scheduleId),
    unassignedDates: result.unassignedDates,
    preferenceViolations: result.preferenceViolations,
    summary: result.summary,
  };
}

/**
 * POST /schedules/generate (gestor). Só rascunhos bloqueiam a geração (Req. 7.8); sobreposição com
 * escala publicada é recusada na publicação (Req. 8.5, task 6.4), não aqui.
 */
export function registerGenerateRoute(
  router: Hono<AuthEnv>,
  deps: {
    db: Sql;
    now?: (() => Date) | undefined;
    rotationAdjusters?: RotationAdjustersProvider | undefined;
  },
): void {
  const now = deps.now ?? (() => new Date());
  router.post('/schedules/generate', requireRole('manager'), async (c) => {
    const parsed = generateBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        {
          error: 'validation_error',
          message: parsed.error.issues[0]?.message ?? 'Dados inválidos',
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        400,
      );
    }
    try {
      const result = await deps.db.begin((tx) =>
        generateDraft(tx as unknown as Sql, {
          body: parsed.data,
          actorId: c.get('user')!.id,
          now: now(),
          teamId: c.get('teamId')!,
          rotationAdjusters: deps.rotationAdjusters,
        }),
      );
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof ScheduleOverlapError) {
        return c.json(
          {
            error: 'schedule_overlap',
            message: 'O período se sobrepõe a um rascunho existente',
            scheduleId: err.scheduleId,
          },
          409,
        );
      }
      throw err;
    }
  });
}
