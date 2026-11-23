import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { recordAudit } from '../audit/index.js';
import { requireAuth } from '../auth/authz.js';
import type { AuthEnv } from '../auth/types.js';
import type { Sql } from '../db.js';
import { getPreferences, upsertPreferences } from './service.js';
import { MAX_CONSECUTIVE_LIMIT, type PreferencesDto, type UserPreferencesDto } from './types.js';

export interface PreferencesRouterDeps {
  db: Sql;
}

const weekday = z
  .number({ error: 'Dia da semana inválido' })
  .int('Dia da semana inválido')
  .min(0, 'Dia da semana deve estar entre 0 (domingo) e 6 (sábado)')
  .max(6, 'Dia da semana deve estar entre 0 (domingo) e 6 (sábado)');

const maxMessage = `Máximo de plantões consecutivos deve estar entre 1 e ${MAX_CONSECUTIVE_LIMIT}`;

const putBody = z
  .object({
    avoidWeekdays: z
      .array(weekday, { error: 'avoidWeekdays deve ser uma lista de dias da semana' })
      .refine((days) => new Set(days).size === days.length, {
        message: 'Dias da semana não podem se repetir',
      }),
    maxConsecutiveShifts: z
      .number({ error: 'Máximo de plantões consecutivos inválido' })
      .int('Máximo de plantões consecutivos deve ser inteiro')
      .min(1, maxMessage)
      .max(MAX_CONSECUTIVE_LIMIT, maxMessage)
      .nullable(),
  })
  .strict();

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

const dto = (userId: string, prefs: PreferencesDto): UserPreferencesDto => ({ userId, ...prefs });

export function createPreferencesRouter({ db }: PreferencesRouterDeps): Hono<AuthEnv> {
  const router = new Hono<AuthEnv>();
  router.use('/me/preferences', requireAuth());
  router.use('/users/:id/preferences', requireAuth());

  router.get('/me/preferences', async (c) => {
    const user = c.get('user')!;
    return c.json({ preferences: dto(user.id, await getPreferences(db, user.id)) });
  });

  router.put('/me/preferences', async (c) => {
    const user = c.get('user')!;
    const parsed = putBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error);

    const after = await db.begin(async (tx) => {
      const before = await getPreferences(tx, user.id, true);
      const saved = await upsertPreferences(tx, user.id, parsed.data);
      await recordAudit(tx, {
        actorId: user.id,
        action: 'preferences.update',
        entityType: 'preferences',
        entityId: user.id,
        before: { ...before },
        after: { ...saved },
      });
      return saved;
    });
    return c.json({ preferences: dto(user.id, after) });
  });

  router.get('/users/:id/preferences', async (c) => {
    const user = c.get('user')!;
    if (user.role !== 'manager') {
      return c.json(
        { error: 'forbidden', message: 'Apenas o gestor consulta preferências de outros membros' },
        403,
      );
    }
    const notFound = () => c.json({ error: 'not_found', message: 'Usuário não encontrado' }, 404);
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return notFound();
    const [exists] = await db`select 1 from users where id = ${id.data}`;
    if (!exists) return notFound();
    return c.json({ preferences: dto(id.data, await getPreferences(db, id.data)) });
  });

  return router;
}
