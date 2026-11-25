import { Hono, type Context } from 'hono';
import type { ZodType } from 'zod';
import { requireAuth, requireRole, type AuthEnv } from '../auth/index.js';
import type { Sql } from '../db.js';
import { TeamsError } from '../teams/index.js';
import { requireTeam } from '../teams/middleware.js';
import type { FutureShiftsFinder } from './types.js';
import {
  PROTECTED_PROFILE_FIELDS,
  UsersError,
  createUser,
  createUserSchema,
  getProfile,
  listFutureShifts,
  listUsers,
  updateProfile,
  updateProfileSchema,
  updateUser,
  updateUserSchema,
} from './service.js';

export interface UsersRouterDeps {
  db: Sql;
  futureShiftsFinder?: FutureShiftsFinder;
  now?: () => Date;
  appBaseUrl?: string | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Issue {
  path: string;
  message: string;
}

const invalid = (c: Context, message: string, issues?: Issue[]) =>
  c.json({ error: 'invalid_request', message, ...(issues ? { issues } : {}) }, 400);

async function readJson(c: Context): Promise<{ raw: unknown } | { response: Response }> {
  try {
    return { raw: await c.req.json() };
  } catch {
    return { response: invalid(c, 'Corpo da requisição inválido') };
  }
}

function parseWith<T>(
  c: Context,
  schema: ZodType<T>,
  raw: unknown,
): { data: T } | { response: Response } {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { data: parsed.data };
  const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  return { response: invalid(c, issues[0]?.message ?? 'Dados inválidos', issues) };
}

export function createUsersRouter({ db, futureShiftsFinder, now }: UsersRouterDeps): Hono<AuthEnv> {
  const router = new Hono<AuthEnv>();

  router.onError((err, c) => {
    if (err instanceof UsersError) {
      return c.json({ error: err.code, message: err.message, ...(err.details ?? {}) }, err.status);
    }
    if (err instanceof TeamsError) {
      return c.json({ error: err.code, message: err.message }, err.status);
    }
    throw err;
  });

  // Papel e rodízio refletem a equipe ativa (o middleware de equipe sobrescreve `user`).
  router.get('/me', requireAuth(), async (c) => {
    const user = c.get('user')!;
    const profile = await getProfile(db, user.id);
    return c.json({
      ...profile,
      role: user.role,
      participatesInRotation: user.participatesInRotation,
    });
  });

  router.patch('/me', requireAuth(), async (c) => {
    const body = await readJson(c);
    if ('response' in body) return body.response;
    if (body.raw && typeof body.raw === 'object' && !Array.isArray(body.raw)) {
      const forbidden = PROTECTED_PROFILE_FIELDS.filter((f) => f in (body.raw as object));
      if (forbidden.length > 0) {
        return c.json(
          {
            error: 'protected_field',
            message: `Os campos ${forbidden.join(', ')} não podem ser alterados pelo próprio usuário`,
          },
          400,
        );
      }
    }
    const input = parseWith(c, updateProfileSchema, body.raw);
    if ('response' in input) return input.response;
    return c.json(await updateProfile(db, c.get('user')!.id, input.data));
  });

  router.get('/users/colleagues', requireAuth(), requireTeam(), async (c) => {
    const me = c.get('user')!.id;
    const rows = await db<{ id: string; name: string }[]>`
      select u.id, u.name from users u
      join team_members m on m.user_id = u.id and m.team_id = ${c.get('teamId')}
      where u.active and m.participates_in_rotation and u.id <> ${me}
      order by u.name, u.id`;
    return c.json(rows);
  });

  // Qualquer usuário autenticado vê a foto dos colegas (escala no calendário).
  router.get('/users/:id/photo', requireAuth(), async (c) => {
    const id = c.req.param('id');
    const [row] = UUID.test(id)
      ? await db<{ photo: Buffer; type: string }[]>`
          select photo, photo_type as type from users where id = ${id} and photo is not null`
      : [];
    // 404 sem cache: a foto pode chegar no próximo login.
    if (!row) return c.json({ error: 'not_found', message: 'Foto não encontrada' }, 404);
    c.header('cache-control', 'private, max-age=3600');
    c.header('content-type', row.type);
    c.header('x-content-type-options', 'nosniff');
    return c.body(new Uint8Array(row.photo));
  });

  // Cartão de visita de quem está de plantão: qualquer usuário autenticado vê nome, e-mail, telefone e crachá.
  router.get('/users/:id/contact', requireAuth(), async (c) => {
    const id = c.req.param('id');
    const [row] = UUID.test(id)
      ? await db<
          {
            id: string;
            name: string;
            email: string;
            phone: string | null;
            badgeNumber: string | null;
          }[]
        >`
          select id, name, email, phone, badge_number as "badgeNumber" from users where id = ${id} and active`
      : [];
    if (!row) return c.json({ error: 'not_found', message: 'Usuário não encontrado' }, 404);
    return c.json(row);
  });

  router.get('/users', requireRole('manager'), async (c) => c.json(await listUsers(db)));

  router.post('/users', requireRole('manager'), async (c) => {
    const body = await readJson(c);
    if ('response' in body) return body.response;
    const input = parseWith(c, createUserSchema, body.raw);
    if ('response' in input) return input.response;
    return c.json(await createUser(db, c.get('user')!, input.data), 201);
  });

  router.patch('/users/:id', requireRole('manager'), async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) {
      return c.json({ error: 'not_found', message: 'Usuário não encontrado' }, 404);
    }
    const body = await readJson(c);
    if ('response' in body) return body.response;
    const input = parseWith(c, updateUserSchema, body.raw);
    if ('response' in input) return input.response;
    return c.json(
      await updateUser(db, c.get('user')!.id, id, input.data, {
        finder: futureShiftsFinder,
        now,
      }),
    );
  });

  router.get('/users/:id/future-shifts', requireRole('manager'), async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) {
      return c.json({ error: 'not_found', message: 'Usuário não encontrado' }, 404);
    }
    await getProfile(db, id);
    return c.json({
      shifts: await listFutureShifts(db, futureShiftsFinder, id, (now ?? (() => new Date()))()),
    });
  });

  return router;
}
