import type { Hono } from 'hono';
import { z } from 'zod';
import { recordAudit } from '../audit/index.js';
import { requireRole } from '../auth/authz.js';
import type { AuthEnv } from '../auth/index.js';
import type { Sql } from '../db.js';
import { getSchedule, listShiftsOfSchedule } from './service.js';
import type { ScheduleDto, ShiftDto } from './types.js';

export interface PublishedEvent {
  schedule: ScheduleDto;
  shifts: ShiftDto[];
  actorId: string;
}

/** Ponto de extensão (task 9.2): chamado após o commit da publicação. */
export type PublishedHook = (event: PublishedEvent) => void | Promise<void>;

export const publishBodySchema = z.object({ confirmUnassigned: z.boolean().optional() });

const err = (error: string, message: string, extra: object = {}) => ({ error, message, ...extra });

type PublishOutcome =
  | { kind: 'error'; status: 404 | 409; body: object }
  | { kind: 'ok'; event: PublishedEvent; unassignedDates: string[] };

export function registerPublishRoutes(
  router: Hono<AuthEnv>,
  deps: { db: Sql; now?: (() => Date) | undefined; onPublished?: PublishedHook | undefined },
): void {
  const now = deps.now ?? (() => new Date());

  /** POST /schedules/:id/publish — Req. 8.2, 8.3, 8.5, 8.7. */
  router.post('/schedules/:id/publish', requireRole('manager'), async (c) => {
    const id = c.req.param('id');
    const parsed = publishBodySchema.safeParse((await c.req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) {
      return c.json(err('validation_error', 'confirmUnassigned deve ser booleano'), 400);
    }
    if (!z.uuid().safeParse(id).success) {
      return c.json(err('not_found', 'Escala não encontrada'), 404);
    }
    const actorId = c.get('user')!.id;
    const publishedAt = now();

    const outcome = await deps.db.begin(async (txRaw): Promise<PublishOutcome> => {
      const tx = txRaw as unknown as Sql;
      await tx`select pg_advisory_xact_lock(hashtext('schedules.publish'))`;
      const [row] = await tx<{ status: string; start: string; end: string }[]>`
        select status, start_date::text as start, end_date::text as "end"
        from schedules where id = ${id} for update`;
      if (!row) {
        return { kind: 'error', status: 404, body: err('not_found', 'Escala não encontrada') };
      }
      if (row.status !== 'draft') {
        return { kind: 'error', status: 409, body: err('not_draft', 'A escala já está publicada') };
      }
      const [overlap] = await tx<{ id: string }[]>`
        select id from schedules
        where status = 'published' and id <> ${id}
          and start_date <= ${row.end}::date and end_date >= ${row.start}::date
        limit 1`;
      if (overlap) {
        return {
          kind: 'error',
          status: 409,
          body: err(
            'schedule_overlap_published',
            'O período se sobrepõe a uma escala já publicada',
            { scheduleId: overlap.id },
          ),
        };
      }
      const unassigned = await tx<{ date: string }[]>`
        select date::text as date from shifts
        where schedule_id = ${id} and user_id is null and hours > 0 order by date`;
      const unassignedDates = unassigned.map((r) => r.date);
      if (unassignedDates.length > 0 && parsed.data.confirmUnassigned !== true) {
        return {
          kind: 'error',
          status: 409,
          body: err(
            'confirmation_required',
            'Há dias sem responsável; confirme explicitamente para publicar',
            { unassignedDates },
          ),
        };
      }
      await tx`update shifts set original_user_id = user_id, original_hours = hours,
        updated_at = now() where schedule_id = ${id}`;
      await tx`update schedules set status = 'published',
        published_at = ${publishedAt.toISOString()}::timestamptz, updated_at = now()
        where id = ${id}`;
      await recordAudit(tx, {
        actorId,
        action: 'schedule.publish',
        entityType: 'schedule',
        entityId: id,
        before: { status: 'draft' },
        after: {
          status: 'published',
          from: row.start,
          to: row.end,
          unassignedDates,
          confirmedUnassigned: unassignedDates.length > 0,
        },
      });
      const schedule = (await getSchedule(tx, id))!;
      return {
        kind: 'ok',
        unassignedDates,
        event: { schedule, shifts: await listShiftsOfSchedule(tx, id), actorId },
      };
    });

    if (outcome.kind === 'error') return c.json(outcome.body, outcome.status);
    if (deps.onPublished) {
      try {
        await deps.onPublished(outcome.event);
      } catch {
        // falha de notificação não desfaz a publicação já commitada
      }
    }
    return c.json({
      schedule: outcome.event.schedule,
      shifts: outcome.event.shifts,
      unassignedDates: outcome.unassignedDates,
    });
  });

  /** DELETE /schedules/:id — descarta apenas rascunho. */
  router.delete('/schedules/:id', requireRole('manager'), async (c) => {
    const id = c.req.param('id');
    if (!z.uuid().safeParse(id).success) {
      return c.json(err('not_found', 'Escala não encontrada'), 404);
    }
    const actorId = c.get('user')!.id;
    const status = await deps.db.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const [row] = await tx<{ status: string; start: string; end: string }[]>`
        select status, start_date::text as start, end_date::text as "end"
        from schedules where id = ${id} for update`;
      if (!row) return 404 as const;
      if (row.status !== 'draft') return 409 as const;
      await tx`delete from schedules where id = ${id}`;
      await recordAudit(tx, {
        actorId,
        action: 'schedule.discard',
        entityType: 'schedule',
        entityId: id,
        before: { status: 'draft', from: row.start, to: row.end },
      });
      return 204 as const;
    });
    if (status === 404) return c.json(err('not_found', 'Escala não encontrada'), 404);
    if (status === 409) {
      return c.json(err('not_draft', 'Apenas rascunhos podem ser descartados'), 409);
    }
    return c.body(null, 204);
  });
}
