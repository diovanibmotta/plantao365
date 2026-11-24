import { Hono, type Context } from 'hono';
import type { TransactionSql } from 'postgres';
import { z } from 'zod';
import { requireAuth } from '../auth/authz.js';
import type { AuthEnv } from '../auth/types.js';
import type { Sql } from '../db.js';
import {
  createSwap,
  getSwap,
  listSwaps,
  transitionSwap,
  type Failure,
  type SwapAction,
} from './service.js';
import {
  SWAP_KINDS,
  SWAP_STATUSES,
  type SwapDto,
  type SwapEventHook,
  type SwapEventType,
} from './types.js';

export interface SwapsRouterDeps {
  db: Sql;
  now?: () => Date;
  /** Ponto de extensão (task 9.3): chamado na transação da mutação (em savepoint); falhas não a desfazem. */
  onSwapEvent?: SwapEventHook;
}

const reasonText = z
  .string()
  .trim()
  .max(500, 'O texto deve ter no máximo 500 caracteres')
  .transform((s) => (s === '' ? null : s))
  .nullish();

const createBody = z
  .object({
    kind: z.enum(SWAP_KINDS, { error: 'Tipo de troca inválido' }),
    shiftId: z.uuid({ error: 'Plantão inválido' }),
    counterpartId: z.uuid({ error: 'Colega inválido' }),
    counterpartShiftId: z.uuid({ error: 'Plantão do colega inválido' }).nullish(),
    note: reasonText,
  })
  .refine((b) => (b.kind === 'swap') === Boolean(b.counterpartShiftId), {
    message: 'A permuta exige o plantão do colega; a cessão não deve informá-lo',
    path: ['counterpartShiftId'],
  });

const actionBody = z.object({ reason: reasonText });
const listQuery = z.object({
  status: z.enum(SWAP_STATUSES, { error: 'Status inválido' }).optional(),
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

const failure = (c: Ctx, f: Failure) => c.json({ error: f.error, message: f.message }, f.status);
const notFound = (c: Ctx) =>
  c.json({ error: 'not_found', message: 'Solicitação não encontrada' }, 404);

const ACTIONS: SwapAction[] = ['accept', 'decline', 'cancel', 'approve', 'reject'];

export function createSwapsRouter({
  db,
  now = () => new Date(),
  onSwapEvent,
}: SwapsRouterDeps): Hono<AuthEnv> {
  const router = new Hono<AuthEnv>();
  router.use('/swaps', requireAuth());
  router.use('/swaps/*', requireAuth());

  const emit = async (
    tx: Sql,
    type: SwapEventType,
    swap: SwapDto,
    actorId: string,
    reason: string | null,
  ) => {
    if (!onSwapEvent) return;
    try {
      await (tx as unknown as TransactionSql).savepoint((sp) =>
        onSwapEvent({ type, swap, actorId, reason }, sp as unknown as Sql),
      );
    } catch {
      // falha de notificação desfaz só o savepoint; a mutação continua
    }
  };

  router.post('/swaps', async (c) => {
    const user = c.get('user')!;
    const parsed = createBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error);
    const b = parsed.data;
    const result = await db.begin(async (t) => {
      const tx = t as unknown as Sql;
      const r = await createSwap(tx, {
        kind: b.kind,
        requesterId: user.id,
        counterpartId: b.counterpartId,
        shiftId: b.shiftId,
        counterpartShiftId: b.counterpartShiftId ?? null,
        note: b.note ?? null,
        now: now(),
      });
      if (r.ok) await emit(tx, 'requested', r.value, user.id, null);
      return r;
    });
    if (!result.ok) return failure(c, result);
    return c.json({ swap: result.value }, 201);
  });

  /** Membro: só as próprias/recebidas. Gestor: todas. Filtro opcional ?status=. */
  router.get('/swaps', async (c) => {
    const user = c.get('user')!;
    const parsed = listQuery.safeParse(c.req.query());
    if (!parsed.success) return invalid(c, parsed.error);
    const items = await listSwaps(db, {
      userId: user.role === 'manager' ? undefined : user.id,
      status: parsed.data.status,
    });
    return c.json({ items });
  });

  router.get('/swaps/:id', async (c) => {
    const user = c.get('user')!;
    const id = z.uuid().safeParse(c.req.param('id'));
    const swap = id.success ? await getSwap(db, id.data) : null;
    const visible =
      swap &&
      (user.role === 'manager' || swap.requesterId === user.id || swap.counterpartId === user.id);
    if (!swap || !visible) return notFound(c);
    return c.json({ swap });
  });

  for (const action of ACTIONS) {
    router.post(`/swaps/:id/${action}`, async (c) => {
      const user = c.get('user')!;
      const id = z.uuid().safeParse(c.req.param('id'));
      if (!id.success) return notFound(c);
      const raw = await c.req.text();
      const body = actionBody.safeParse(raw ? await c.req.json().catch(() => null) : {});
      if (!body.success) return invalid(c, body.error);
      const reason = body.data.reason ?? null;
      const result = await db.begin(async (t) => {
        const tx = t as unknown as Sql;
        const r = await transitionSwap(tx, {
          action,
          swapId: id.data,
          actorId: user.id,
          actorRole: user.role === 'manager' ? 'manager' : 'member',
          reason,
          now: now(),
        });
        if (r.ok) await emit(tx, r.value.event, r.value.swap, user.id, reason);
        return r;
      });
      if (!result.ok) return failure(c, result);
      return c.json({ swap: result.value.swap });
    });
  }

  return router;
}
