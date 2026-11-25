import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { recordAudit } from '../audit/index.js';
import { requireAuth } from '../auth/authz.js';
import type { AuthEnv, AuthUser } from '../auth/types.js';
import type { TransactionSql } from 'postgres';
import type { Sql } from '../db.js';
import type { Logger } from '../logger.js';
import {
  mergeScheduleImpacts,
  runScheduleImpact,
  type ScheduleImpact,
  type ScheduleImpactNotifier,
} from '../schedule-impact/index.js';
import {
  deleteUnavailability,
  getUnavailability,
  insertUnavailability,
  listUnavailabilities,
  updateUnavailability,
} from './service.js';
import {
  MEMBER_KINDS,
  UNAVAILABILITY_KINDS,
  type CollectiveImpactChecker,
  type ConflictChecker,
  type UnavailabilityConflictEvent,
  type UnavailabilityDto,
  type UnavailabilityWarning,
} from './types.js';

export interface UnavailabilityRouterDeps {
  db: Sql;
  conflictChecker?: ConflictChecker;
  /** Férias coletivas: conta plantões publicados por data (Req. 5.6); sem ele, não há aviso. */
  collectiveImpactChecker?: CollectiveImpactChecker;
  /**
   * Chamado DENTRO da transação da mutação (antes do commit), com o `sql` dessa transação, quando
   * uma exceção de MEMBRO conflita com plantão publicado e o autor não é gestor (o gestor já recebe
   * os avisos na própria resposta). Roda num savepoint: se lançar, só o gancho é desfeito (a exceção
   * permanece) e o erro é registrado. Quem enfileira e-mail deve usar o `sql` recebido, para o
   * outbox ser atômico com a mudança.
   */
  onConflict?: (event: UnavailabilityConflictEvent, sql: Sql) => Promise<void> | void;
  /**
   * Regra core: qualquer exceção/férias que atinja plantão publicado avisa a tela (`scheduleImpact`
   * na resposta) e os gestores da equipe por e-mail, atomicamente com a mudança.
   */
  scheduleImpactNotifier?: ScheduleImpactNotifier;
  logger?: Logger | undefined;
}

/** Datas AAAA-MM-DD de `start` a `end` (inclusive), em UTC para evitar deslocamento de fuso. */
function expandDates(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 864e5) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const date = z.iso.date({ error: 'Data inválida; use AAAA-MM-DD' });
const note = z.string().max(500, 'A observação deve ter no máximo 500 caracteres');
const periodMessage = 'A data final não pode ser anterior à data inicial';

const listQuery = z
  .object({ from: date.optional(), to: date.optional(), userId: z.uuid().optional() })
  .refine((q) => !q.from || !q.to || q.to >= q.from, { message: periodMessage, path: ['to'] });

const createBody = z
  .object({
    kind: z.enum(UNAVAILABILITY_KINDS),
    startDate: date,
    endDate: date,
    note: note.nullish(),
    userId: z.uuid().optional(),
    /** Só férias coletivas: restringe a coletiva a estes membros (sem isto vale p/ todo o time). */
    userIds: z.array(z.uuid()).min(1).max(200).optional(),
  })
  .refine((b) => b.endDate >= b.startDate, { message: periodMessage, path: ['endDate'] });

const patchBody = z
  .object({
    kind: z.enum(MEMBER_KINDS).optional(),
    startDate: date.optional(),
    endDate: date.optional(),
    note: note.nullable().optional(),
  })
  .strict();

const idSchema = z.uuid();

type Ctx = Context<AuthEnv>;

const invalid = (c: Ctx, error: z.ZodError) =>
  c.json(
    {
      error: 'validation_error',
      message: error.issues[0]?.message ?? 'Dados inválidos',
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    },
    400,
  );

const fail = (c: Ctx, status: 400 | 403 | 404, error: string, message: string) =>
  c.json({ error, message }, status);

export function createUnavailabilityRouter({
  db,
  conflictChecker,
  collectiveImpactChecker,
  onConflict,
  scheduleImpactNotifier,
  logger,
}: UnavailabilityRouterDeps): Hono<AuthEnv> {
  const check: ConflictChecker = conflictChecker ?? (async () => []);
  const router = new Hono<AuthEnv>();
  router.use('/unavailabilities', requireAuth());
  router.use('/unavailabilities/*', requireAuth());

  const warningsFor = async (
    sql: Sql,
    row: UnavailabilityDto,
  ): Promise<UnavailabilityWarning[]> => {
    const found = await check(sql, { userId: row.userId, start: row.startDate, end: row.endDate });
    const warnings: UnavailabilityWarning[] = found.map((f) => ({
      type: 'published_shift_conflict',
      date: f.date,
      userId: f.userId,
    }));
    if (row.userId === null && collectiveImpactChecker) {
      const impact = await collectiveImpactChecker(
        sql,
        expandDates(row.startDate, row.endDate),
        row.teamId ?? undefined,
      );
      for (const i of impact) {
        if (i.count > 0)
          warnings.push({ type: 'published_shifts_affected', date: i.date, count: i.count });
      }
    }
    return warnings;
  };

  /** Roda dentro da transação da mutação: calcula avisos e enfileira a notificação atomicamente. */
  const warnAndNotify = async (
    tx: TransactionSql,
    row: UnavailabilityDto,
    actor: AuthUser,
  ): Promise<UnavailabilityWarning[]> => {
    const warnings = await warningsFor(tx as unknown as Sql, row);
    const dates = [
      ...new Set(warnings.flatMap((w) => (w.type === 'published_shift_conflict' ? [w.date] : []))),
    ].sort();
    if (onConflict && row.userId && actor.role !== 'manager' && dates.length > 0) {
      const event: UnavailabilityConflictEvent = {
        unavailabilityId: row.id,
        userId: row.userId,
        startDate: row.startDate,
        endDate: row.endDate,
        dates,
        actorId: actor.id,
      };
      try {
        await tx.savepoint(async (sp) => {
          await onConflict(event, sp as unknown as Sql);
        });
      } catch (err) {
        // a falha do gancho desfaz só o savepoint; a mutação segue e é confirmada
        logger?.error({ err, unavailabilityId: row.id }, 'Falha no gancho onConflict da exceção');
      }
    }
    return warnings;
  };

  /** Roda dentro da transação da mutação: avisa a tela e os gestores se a escala publicada é atingida. */
  const impactOf = (
    tx: TransactionSql,
    row: UnavailabilityDto,
    actor: AuthUser,
  ): Promise<ScheduleImpact | null> =>
    runScheduleImpact(
      tx as unknown as Sql,
      scheduleImpactNotifier,
      row.userId
        ? {
            source: 'member_exception',
            actorId: actor.id,
            userId: row.userId,
            start: row.startDate,
            end: row.endDate,
          }
        : {
            source: 'collective_vacation',
            actorId: actor.id,
            teamId: row.teamId,
            start: row.startDate,
            end: row.endDate,
          },
      logger,
    );

  const canTouch = (user: AuthUser, row: UnavailabilityDto) =>
    user.role === 'manager' || row.userId === user.id;

  router.get('/unavailabilities', async (c) => {
    const user = c.get('user')!;
    const parsed = listQuery.safeParse(c.req.query());
    if (!parsed.success) return invalid(c, parsed.error);
    const { from, to, userId } = parsed.data;
    const isManager = user.role === 'manager';
    if (!isManager && userId && userId !== user.id) {
      return fail(c, 403, 'forbidden', 'Você não pode consultar exceções de outros membros');
    }
    const items = await listUnavailabilities(db, {
      from,
      to,
      userId,
      visibleTo: isManager ? undefined : user.id,
      selfId: user.id,
      teamId: c.get('teamId') ?? undefined,
    });
    return c.json({ items });
  });

  router.post('/unavailabilities', async (c) => {
    const user = c.get('user')!;
    const parsed = createBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error);
    const input = parsed.data;
    const isManager = user.role === 'manager';
    // null = coletiva p/ todo o time; lista = uma linha 'vacation' por membro escolhido
    let targets: (string | null)[];

    if (input.kind === 'collective_vacation') {
      if (!isManager) {
        return fail(c, 403, 'forbidden', 'Apenas o gestor cadastra férias coletivas');
      }
      if (input.userId) {
        return fail(c, 400, 'validation_error', 'Férias coletivas não têm usuário associado');
      }
      targets = [null];
      if (input.userIds) {
        const ids = [...new Set(input.userIds)];
        const found = await db<{ id: string; active: boolean }[]>`
          select id, active from users where id in ${db(ids)}`;
        if (found.length !== ids.length) {
          return fail(c, 404, 'user_not_found', 'Usuário não encontrado');
        }
        if (found.some((u) => !u.active)) return fail(c, 400, 'user_inactive', 'Usuário inativo');
        targets = ids;
      }
    } else {
      if (input.userIds) {
        return fail(c, 400, 'validation_error', 'userIds só vale para férias coletivas');
      }
      const targetId = input.userId ?? user.id;
      if (!isManager && targetId !== user.id) {
        return fail(c, 403, 'forbidden', 'Você só pode cadastrar exceções para si mesmo');
      }
      const [target] = await db<{ active: boolean }[]>`
        select active from users where id = ${targetId}`;
      if (!target) return fail(c, 404, 'user_not_found', 'Usuário não encontrado');
      if (!target.active) return fail(c, 400, 'user_inactive', 'Usuário inativo');
      targets = [targetId];
    }

    const kind = input.userIds ? 'vacation' : input.kind;
    const row = await db.begin(async (tx) => {
      const created: UnavailabilityDto[] = [];
      const warnings: UnavailabilityWarning[] = [];
      const impacts: ScheduleImpact[] = [];
      for (const userId of targets) {
        const item = await insertUnavailability(tx, {
          userId,
          kind,
          startDate: input.startDate,
          endDate: input.endDate,
          note: input.note ?? null,
          createdBy: user.id,
          teamId: c.get('teamId'),
        });
        await recordAudit(tx, {
          actorId: user.id,
          action: 'unavailability.create',
          entityType: 'unavailability',
          entityId: item.id,
          after: { ...item },
        });
        created.push(item);
        warnings.push(...(await warnAndNotify(tx, item, user)));
        const impact = await impactOf(tx, item, user);
        if (impact) impacts.push(impact);
      }
      return { created, warnings, scheduleImpact: mergeScheduleImpacts(impacts) };
    });
    return c.json(
      {
        unavailability: row.created[0],
        unavailabilities: row.created,
        warnings: row.warnings,
        ...(row.scheduleImpact && { scheduleImpact: row.scheduleImpact }),
      },
      201,
    );
  });

  router.patch('/unavailabilities/:id', async (c) => {
    const user = c.get('user')!;
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return fail(c, 404, 'not_found', 'Exceção não encontrada');
    const parsed = patchBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error);
    const patch = parsed.data;

    const outcome = await db.begin(async (tx) => {
      const before = await getUnavailability(tx, id.data, true);
      if (!before || (!canTouch(user, before) && before.userId !== null)) {
        return { status: 404 as const };
      }
      if (!canTouch(user, before)) return { status: 403 as const };
      if (patch.kind && before.kind === 'collective_vacation') return { status: 'kind' as const };
      const next = {
        kind: patch.kind ?? before.kind,
        startDate: patch.startDate ?? before.startDate,
        endDate: patch.endDate ?? before.endDate,
        note: patch.note === undefined ? before.note : patch.note,
      };
      if (next.endDate < next.startDate) return { status: 'period' as const };
      const after = await updateUnavailability(tx, id.data, next);
      await recordAudit(tx, {
        actorId: user.id,
        action: 'unavailability.update',
        entityType: 'unavailability',
        entityId: id.data,
        before: { ...before },
        after: { ...after },
      });
      return {
        status: 200 as const,
        after,
        warnings: await warnAndNotify(tx, after, user),
        scheduleImpact: await impactOf(tx, after, user),
      };
    });

    switch (outcome.status) {
      case 404:
        return fail(c, 404, 'not_found', 'Exceção não encontrada');
      case 403:
        return fail(c, 403, 'forbidden', 'Apenas o gestor altera férias coletivas');
      case 'kind':
        return fail(c, 400, 'validation_error', 'Férias coletivas não mudam de tipo');
      case 'period':
        return fail(c, 400, 'validation_error', periodMessage);
      default:
        return c.json({
          unavailability: outcome.after,
          warnings: outcome.warnings,
          ...(outcome.scheduleImpact && { scheduleImpact: outcome.scheduleImpact }),
        });
    }
  });

  router.delete('/unavailabilities/:id', async (c) => {
    const user = c.get('user')!;
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return fail(c, 404, 'not_found', 'Exceção não encontrada');

    const status = await db.begin(async (tx) => {
      const before = await getUnavailability(tx, id.data, true);
      if (!before || (!canTouch(user, before) && before.userId !== null)) return 404 as const;
      if (!canTouch(user, before)) return 403 as const;
      await deleteUnavailability(tx, id.data);
      await recordAudit(tx, {
        actorId: user.id,
        action: 'unavailability.delete',
        entityType: 'unavailability',
        entityId: id.data,
        before: { ...before },
      });
      return 204 as const;
    });

    if (status === 404) return fail(c, 404, 'not_found', 'Exceção não encontrada');
    if (status === 403) {
      return fail(c, 403, 'forbidden', 'Apenas o gestor remove férias coletivas');
    }
    return c.body(null, 204);
  });

  return router;
}
