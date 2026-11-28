import { yearOf } from '@plantao365/shared';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { recordAudit } from '../audit/index.js';
import { publishEvent } from '../events/publisher.js';
import { requireAuth } from '../auth/authz.js';
import type { AuthEnv } from '../auth/types.js';
import type { Sql } from '../db.js';
import {
  computeBalance,
  deleteAdjustment,
  emptyMonths,
  getAdjustment,
  insertAdjustment,
  listAdjustments,
  listShiftDetails,
  totalsOf,
} from './service.js';

export interface BalanceRouterDeps {
  db: Sql;
  now?: () => Date;
}

const year = z.coerce
  .number({ error: 'Ano inválido' })
  .int('Ano inválido')
  .min(2000, 'Ano inválido')
  .max(2100, 'Ano inválido');

const yearQuery = z.object({ year: year.optional() });
const adjustmentsQuery = z.object({ userId: z.uuid().optional(), year: year.optional() });

const oneDecimal = (n: number) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;

const adjustmentBody = z.object({
  userId: z.uuid({ error: 'Usuário inválido' }),
  date: z.iso.date({ error: 'Data inválida; use AAAA-MM-DD' }),
  hours: z
    .number({ error: 'Horas inválidas' })
    .min(-48, 'As horas devem estar entre -48 e 48')
    .max(48, 'As horas devem estar entre -48 e 48')
    .refine((h) => h !== 0, 'As horas devem ser diferentes de zero')
    .refine(oneDecimal, 'As horas aceitam no máximo 1 casa decimal'),
  reason: z
    .string({ error: 'Informe o motivo' })
    .trim()
    .min(1, 'Informe o motivo')
    .max(300, 'O motivo deve ter no máximo 300 caracteres'),
});

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

const forbidden = (c: Ctx) =>
  fail(c, 403, 'forbidden', 'Apenas o gestor pode consultar ou ajustar o saldo de outros membros');

export function createBalanceRouter({
  db,
  now = () => new Date(),
}: BalanceRouterDeps): Hono<AuthEnv> {
  const router = new Hono<AuthEnv>();
  for (const p of ['/me/balance', '/balance', '/balance/*', '/users/:id/balance']) {
    router.use(p, requireAuth());
  }

  const memberBalance = async (userId: string, y: number) => {
    const at = now();
    const [balance] = await computeBalance(db, { userId, year: y, now: at });
    const months = balance?.months ?? emptyMonths(y);
    return {
      year: y,
      userId,
      months,
      total: totalsOf(months),
      shifts: await listShiftDetails(db, { userId, year: y, now: at }),
    };
  };

  router.get('/me/balance', async (c) => {
    const parsed = yearQuery.safeParse(c.req.query());
    if (!parsed.success) return invalid(c, parsed.error);
    const y = parsed.data.year ?? yearOf(now());
    return c.json(await memberBalance(c.get('user')!.id, y));
  });

  router.get('/users/:id/balance', async (c) => {
    const user = c.get('user')!;
    if (user.role !== 'manager') return forbidden(c);
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return fail(c, 404, 'user_not_found', 'Usuário não encontrado');
    const parsed = yearQuery.safeParse(c.req.query());
    if (!parsed.success) return invalid(c, parsed.error);
    const [target] = await db<{ id: string }[]>`
      select user_id as id from team_members
      where user_id = ${id.data} and team_id = ${c.get('teamId')}`;
    if (!target) return fail(c, 404, 'user_not_found', 'Usuário não encontrado');
    return c.json(await memberBalance(id.data, parsed.data.year ?? yearOf(now())));
  });

  router.get('/balance', async (c) => {
    if (c.get('user')!.role !== 'manager') return forbidden(c);
    const parsed = yearQuery.safeParse(c.req.query());
    if (!parsed.success) return invalid(c, parsed.error);
    const y = parsed.data.year ?? yearOf(now());
    const all = await computeBalance(db, { year: y, now: now() });
    const balances = new Map(all.map((b) => [b.userId, b]));
    const users = await db<{ id: string; name: string }[]>`
      select u.id, u.name from users u
      join team_members m on m.user_id = u.id and m.team_id = ${c.get('teamId')}
      where u.active
        and (m.participates_in_rotation or u.id = any(${[...balances.keys()]}::uuid[]))
      order by u.name, u.id`;
    const members = users.map((u) => {
      const months = balances.get(u.id)?.months ?? emptyMonths(y);
      return { userId: u.id, name: u.name, ...totalsOf(months), months };
    });
    return c.json({ year: y, members });
  });

  router.get('/balance/adjustments', async (c) => {
    if (c.get('user')!.role !== 'manager') return forbidden(c);
    const parsed = adjustmentsQuery.safeParse(c.req.query());
    if (!parsed.success) return invalid(c, parsed.error);
    const items = await listAdjustments(db, {
      userId: parsed.data.userId,
      year: parsed.data.year ?? yearOf(now()),
    });
    return c.json({ items });
  });

  router.get('/balance/adjustments/:id', async (c) => {
    if (c.get('user')!.role !== 'manager') return forbidden(c);
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return fail(c, 404, 'not_found', 'Ajuste não encontrado');
    const adjustment = await getAdjustment(db, id.data);
    if (!adjustment) return fail(c, 404, 'not_found', 'Ajuste não encontrado');
    return c.json({ adjustment });
  });

  router.post('/balance/adjustments', async (c) => {
    const user = c.get('user')!;
    if (user.role !== 'manager') return forbidden(c);
    const parsed = adjustmentBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error);
    const input = parsed.data;
    const [target] = await db<{ id: string }[]>`
      select user_id as id from team_members
      where user_id = ${input.userId} and team_id = ${c.get('teamId')}`;
    if (!target) return fail(c, 404, 'user_not_found', 'Usuário não encontrado');
    const adjustment = await db.begin(async (tx) => {
      const created = await insertAdjustment(tx, { ...input, createdBy: user.id });
      await recordAudit(tx, {
        actorId: user.id,
        action: 'adjustment.create',
        entityType: 'adjustment',
        entityId: created.id,
        after: { ...created },
        reason: created.reason,
      });
      await publishEvent(tx, 'balance.adjusted', {
        adjustmentId: created.id,
        userId: created.userId,
        date: created.date,
        hours: created.hours,
        reason: created.reason,
        actorId: user.id,
      });
      return created;
    });
    return c.json({ adjustment }, 201);
  });

  router.delete('/balance/adjustments/:id', async (c) => {
    const user = c.get('user')!;
    if (user.role !== 'manager') return forbidden(c);
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return fail(c, 404, 'not_found', 'Ajuste não encontrado');
    const found = await db.begin(async (tx) => {
      const before = await getAdjustment(tx, id.data);
      if (!before) return false;
      await deleteAdjustment(tx, id.data);
      await recordAudit(tx, {
        actorId: user.id,
        action: 'adjustment.delete',
        entityType: 'adjustment',
        entityId: id.data,
        before: { ...before },
      });
      return true;
    });
    if (!found) return fail(c, 404, 'not_found', 'Ajuste não encontrado');
    return c.body(null, 204);
  });

  return router;
}
