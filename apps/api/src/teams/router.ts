import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/authz.js';
import type { AuthEnv } from '../auth/types.js';
import type { Sql } from '../db.js';
import {
  TeamsError,
  createTeam,
  deleteTeam,
  linkTeamMember,
  listAccessibleTeams,
  listTeamMembers,
  updateTeam,
  unlinkTeamMember,
} from './service.js';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const createTeamSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    dashboardUrl: optionalText(500).refine(
      (v) => v === null || /^https?:\/\/\S+$/i.test(v),
      'Informe uma URL http(s) válida',
    ),
    avatar: optionalText(16),
  })
  .strict();
const memberParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

export function createTeamsRouter({ db }: { db: Sql }): Hono<AuthEnv> {
  const router = new Hono<AuthEnv>();

  router.onError((err, c) => {
    if (err instanceof TeamsError) {
      return c.json({ error: err.code, message: err.message }, err.status);
    }
    throw err;
  });

  router.get('/teams', requireAuth(), async (c) =>
    c.json(await listAccessibleTeams(db, c.get('user')!)),
  );

  router.post('/teams', requireRole('manager'), async (c) => {
    const parsed = createTeamSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { error: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Dados inválidos' },
        400,
      );
    }
    return c.json(await createTeam(db, c.get('user')!, parsed.data), 201);
  });

  router.patch('/teams/:id', requireRole('manager'), async (c) => {
    const id = z.string().uuid().safeParse(c.req.param('id'));
    const parsed = createTeamSchema.safeParse(await c.req.json().catch(() => null));
    if (!id.success || !parsed.success) {
      return c.json(
        {
          error: 'invalid_request',
          message: parsed.error?.issues[0]?.message ?? 'Dados inválidos',
        },
        400,
      );
    }
    return c.json(await updateTeam(db, c.get('user')!, id.data, parsed.data));
  });

  router.delete('/teams/:id', requireRole('manager'), async (c) => {
    const id = z.string().uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'invalid_request', message: 'Dados inválidos' }, 400);
    await deleteTeam(db, c.get('user')!, id.data);
    return c.body(null, 204);
  });

  router.get('/teams/:id/members', requireRole('manager'), async (c) => {
    const id = z.string().uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'invalid_request', message: 'Dados inválidos' }, 400);
    return c.json(await listTeamMembers(db, c.get('user')!, id.data));
  });

  router.put('/teams/:id/members/:userId', requireRole('manager'), async (c) => {
    const ids = memberParams.safeParse({ id: c.req.param('id'), userId: c.req.param('userId') });
    if (!ids.success) return c.json({ error: 'invalid_request', message: 'Dados inválidos' }, 400);
    await linkTeamMember(db, c.get('user')!, ids.data.id, ids.data.userId);
    return c.body(null, 204);
  });

  router.delete('/teams/:id/members/:userId', requireRole('manager'), async (c) => {
    const ids = memberParams.safeParse({ id: c.req.param('id'), userId: c.req.param('userId') });
    if (!ids.success) return c.json({ error: 'invalid_request', message: 'Dados inválidos' }, 400);
    await unlinkTeamMember(db, c.get('user')!, ids.data.id, ids.data.userId);
    return c.body(null, 204);
  });

  return router;
}
