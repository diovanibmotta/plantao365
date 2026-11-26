import type { Hono } from 'hono';
import { z } from 'zod';
import { addDays, localToInstant, shiftDuration } from '@diovanibmotta/plantao365-shared';
import { recordAudit } from '../audit/index.js';
import { requireRole } from '../auth/authz.js';
import type { AuthEnv } from '../auth/index.js';
import type { Sql } from '../db.js';
import { listUnavailableByDate } from '../unavailability/service.js';
import { runHookInSavepoint } from './hook.js';
import { getSchedule, listShiftsOfSchedule, lockSchedulesThenShifts } from './service.js';
import type { ScheduleDto, ShiftDto } from './types.js';

export type ShiftWarningCode =
  | 'user_inactive'
  | 'user_not_in_rotation'
  | 'user_unavailable'
  | 'collective_vacation'
  | 'unassigned';

export interface ShiftWarning {
  code: ShiftWarningCode;
  message: string;
}

export interface ShiftChange {
  schedule: ScheduleDto;
  shift: ShiftDto;
  previousUserId: string | null;
  newUserId: string | null;
  previousHours: number;
  reason: string | null;
  actorId: string;
}

/** Ponto de extensão (task 9.2): chamado dentro da transação (savepoint, com o `sql` dela); falha não aborta a edição. */
export type ShiftChangedHook = (change: ShiftChange, sql: Sql) => void | Promise<void>;

const hour = z.number().int().min(0).max(23);

/** `userId` ausente mantém o responsável; `startHour`/`endHour` (juntos) mudam o horário do plantão. */
export const editShiftBodySchema = z
  .object({
    userId: z.uuid().nullable().optional(),
    startHour: hour.optional(),
    endHour: hour.optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .refine((b) => (b.startHour === undefined) === (b.endHour === undefined), {
    message: 'Informe início e fim do plantão',
    path: ['startHour'],
  })
  .refine((b) => b.userId !== undefined || b.startHour !== undefined, {
    message: 'Informe o responsável ou o horário',
    path: ['userId'],
  });

const errorBody = (error: string, message: string, extra: object = {}) => ({
  error,
  message,
  ...extra,
});

/** Conflitos de atribuir `userId` ao dia (Req. 8.1). Só avisos: o gestor decide. */
export async function validateAssignment(
  sql: Sql,
  input: { date: string; hours: number; userId: string | null; teamId?: string },
): Promise<ShiftWarning[]> {
  const warnings: ShiftWarning[] = [];
  if (input.userId === null) {
    if (input.hours > 0) warnings.push({ code: 'unassigned', message: 'Dia sem responsável' });
    return warnings;
  }
  const [user] = await sql<{ active: boolean; participates: boolean }[]>`
    select u.active, coalesce(m.participates_in_rotation, false) as participates
    from users u
    left join team_members m on m.user_id = u.id and m.team_id = ${input.teamId ?? null}
    where u.id = ${input.userId}`;
  if (user) {
    if (!user.active) warnings.push({ code: 'user_inactive', message: 'Usuário inativo' });
    if (!user.participates) {
      warnings.push({
        code: 'user_not_in_rotation',
        message: 'Usuário não participa do revezamento',
      });
    }
  }
  const unavailable = await listUnavailableByDate(sql, input.date, input.date, input.teamId);
  if (unavailable.byUser.get(input.userId)?.includes(input.date)) {
    warnings.push({ code: 'user_unavailable', message: 'Usuário tem exceção nesta data' });
  }
  if (unavailable.collectiveVacations.length > 0) {
    warnings.push({ code: 'collective_vacation', message: 'Data em férias coletivas' });
  }
  return warnings;
}

interface ShiftRow {
  id: string;
  hours: number;
  date: string;
  user_id: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
}

type Outcome =
  | { kind: 'error'; status: 400 | 404 | 422; body: object }
  | { kind: 'ok'; warnings: ShiftWarning[]; change: ShiftChange; published: boolean };

export function registerEditRoutes(
  router: Hono<AuthEnv>,
  deps: { db: Sql; onShiftChanged?: ShiftChangedHook | undefined },
): void {
  /** PATCH /schedules/:id/shifts/:shiftId — troca responsável e/ou horário (rascunho ou publicada). */
  router.patch('/schedules/:id/shifts/:shiftId', requireRole('manager'), async (c) => {
    const { id, shiftId } = c.req.param();
    const parsed = editShiftBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        errorBody('validation_error', parsed.error.issues[0]?.message ?? 'Dados inválidos', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        }),
        400,
      );
    }
    const { reason, startHour, endHour } = parsed.data;
    const actorId = c.get('user')!.id;
    const teamId = c.get('teamId')!;
    if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(shiftId).success) {
      return c.json(errorBody('not_found', 'Plantão não encontrado'), 404);
    }

    const outcome = await deps.db.begin(async (txRaw): Promise<Outcome> => {
      const tx = txRaw as unknown as Sql;
      await lockSchedulesThenShifts(tx, { scheduleIds: [id], shiftIds: [shiftId] });
      const [schedule] = await tx<{ status: ScheduleDto['status'] }[]>`
        select status from schedules where id = ${id} and team_id = ${teamId}`;
      if (!schedule) {
        return {
          kind: 'error',
          status: 404,
          body: errorBody('not_found', 'Escala não encontrada'),
        };
      }
      const [shift] = await tx<ShiftRow[]>`
        select id, hours, date::text as date, user_id, starts_at, ends_at from shifts
        where id = ${shiftId} and schedule_id = ${id}`;
      if (!shift) {
        return {
          kind: 'error',
          status: 404,
          body: errorBody('not_found', 'Plantão não encontrado'),
        };
      }
      const published = schedule.status === 'published';
      if (published && !reason) {
        return {
          kind: 'error',
          status: 400,
          body: errorBody('reason_required', 'Motivo obrigatório para alterar escala publicada'),
        };
      }
      const userId = parsed.data.userId === undefined ? shift.user_id : parsed.data.userId;
      const retime = startHour !== undefined && endHour !== undefined;
      if (shift.hours === 0 && (userId !== null || retime)) {
        return {
          kind: 'error',
          status: 422,
          body: errorBody('shift_not_applicable', 'Dia sem plantão (férias coletivas)'),
        };
      }
      if (userId !== null && userId !== shift.user_id) {
        const [u] = await tx<{ id: string }[]>`
          select user_id as id from team_members
          where user_id = ${userId} and team_id = ${teamId}`;
        if (!u) {
          return {
            kind: 'error',
            status: 400,
            body: errorBody('user_not_found', 'Usuário não encontrado'),
          };
        }
      }
      const warnings = await validateAssignment(tx, {
        date: shift.date,
        hours: shift.hours,
        userId,
        teamId,
      });
      let hours = shift.hours;
      let startsAt = shift.starts_at;
      let endsAt = shift.ends_at;
      if (retime) {
        hours = shiftDuration({ startHour, endHour });
        startsAt = localToInstant(shift.date, startHour);
        endsAt = localToInstant(endHour > startHour ? shift.date : addDays(shift.date, 1), endHour);
      }
      await tx`update shifts set user_id = ${userId}, hours = ${hours},
        starts_at = ${startsAt}, ends_at = ${endsAt}, updated_at = now() where id = ${shiftId}`;
      await tx`update schedules set updated_at = now() where id = ${id}`;
      await recordAudit(tx, {
        actorId,
        action: published ? 'schedule.published_shift_change' : 'schedule.shift_edit',
        entityType: 'shift',
        entityId: shiftId,
        before: {
          scheduleId: id,
          date: shift.date,
          userId: shift.user_id,
          hours: shift.hours,
          startsAt: shift.starts_at?.toISOString() ?? null,
          endsAt: shift.ends_at?.toISOString() ?? null,
        },
        after: {
          scheduleId: id,
          date: shift.date,
          userId,
          hours,
          startsAt: startsAt?.toISOString() ?? null,
          endsAt: endsAt?.toISOString() ?? null,
        },
        reason: reason ?? null,
      });
      const sched = (await getSchedule(tx, id))!;
      const shifts = await listShiftsOfSchedule(tx, id);
      const change: ShiftChange = {
        schedule: sched,
        shift: shifts.find((s) => s.id === shiftId)!,
        previousUserId: shift.user_id,
        newUserId: userId,
        previousHours: shift.hours,
        reason: reason ?? null,
        actorId,
      };
      const { onShiftChanged } = deps;
      if (published && onShiftChanged) {
        await runHookInSavepoint(tx, (sp) => onShiftChanged(change, sp));
      }
      return { kind: 'ok', warnings, published, change };
    });

    if (outcome.kind === 'error') return c.json(outcome.body, outcome.status);
    return c.json({
      shift: outcome.change.shift,
      warnings: outcome.warnings,
      ...(outcome.published
        ? {
            notice: 'Os membros envolvidos serão notificados da alteração.',
            notify: [outcome.change.previousUserId, outcome.change.newUserId].filter(
              (u): u is string => u !== null,
            ),
          }
        : {}),
    });
  });
}
