import type { Hono } from 'hono';
import { z } from 'zod';
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
  reason: string | null;
  actorId: string;
}

/** Ponto de extensão (task 9.2): chamado dentro da transação (savepoint, com o `sql` dela); falha não aborta a edição. */
export type ShiftChangedHook = (change: ShiftChange, sql: Sql) => void | Promise<void>;

export const editShiftBodySchema = z.object({
  userId: z.uuid().nullable(),
  reason: z.string().trim().min(1).max(2000).optional(),
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
    select active, participates_in_rotation as participates from users where id = ${input.userId}`;
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
}

type Outcome =
  | { kind: 'error'; status: 400 | 404 | 422; body: object }
  | { kind: 'ok'; warnings: ShiftWarning[]; change: ShiftChange; published: boolean };

export function registerEditRoutes(
  router: Hono<AuthEnv>,
  deps: { db: Sql; onShiftChanged?: ShiftChangedHook | undefined },
): void {
  /** PATCH /schedules/:id/shifts/:shiftId — troca o responsável (rascunho ou publicada). */
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
    const { userId, reason } = parsed.data;
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
        select id, hours, date::text as date, user_id from shifts
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
      if (shift.hours === 0 && userId !== null) {
        return {
          kind: 'error',
          status: 422,
          body: errorBody('shift_not_applicable', 'Dia sem plantão (férias coletivas)'),
        };
      }
      if (userId !== null) {
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
      await tx`update shifts set user_id = ${userId}, updated_at = now() where id = ${shiftId}`;
      await tx`update schedules set updated_at = now() where id = ${id}`;
      await recordAudit(tx, {
        actorId,
        action: published ? 'schedule.published_shift_change' : 'schedule.shift_edit',
        entityType: 'shift',
        entityId: shiftId,
        before: { scheduleId: id, date: shift.date, userId: shift.user_id },
        after: { scheduleId: id, date: shift.date, userId },
        reason: reason ?? null,
      });
      const sched = (await getSchedule(tx, id))!;
      const shifts = await listShiftsOfSchedule(tx, id);
      const change: ShiftChange = {
        schedule: sched,
        shift: shifts.find((s) => s.id === shiftId)!,
        previousUserId: shift.user_id,
        newUserId: userId,
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
