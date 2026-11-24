import { createMiddleware } from 'hono/factory';
import type { AuthEnv, Role } from './types.js';

const RANK: Record<Role, number> = { guest: 0, member: 1, manager: 2 };

/** Exige sessão válida (inclusive convidado); sem usuário responde 401. */
export const requireAuth = () =>
  createMiddleware<AuthEnv>(async (c, next) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
    await next();
  });

/** Exige sessão e papel mínimo: 'manager' só gestor; 'member' membro ou gestor (não convidado). */
export const requireRole = (role: Role) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'unauthenticated' }, 401);
    if (RANK[user.role] < RANK[role]) return c.json({ error: 'forbidden' }, 403);
    await next();
  });

/** Leituras que o convidado pode fazer: calendário de escala (só publicada) e feriados. */
const GUEST_READ_PATHS: readonly RegExp[] = [
  /^\/api\/me$/,
  /^\/api\/shifts$/,
  /^\/api\/holidays$/,
  /^\/api\/shift-settings$/,
  /^\/api\/schedules(\/[^/]+)?$/,
  /^\/api\/users\/[^/]+\/photo$/,
];

/**
 * Trava global do convidado: só GET/HEAD nas rotas de leitura acima; qualquer outra
 * chamada de /api responde 403. Montar depois do sessionMiddleware e antes dos routers.
 */
export const guestGuard = () =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const user = c.get('user');
    if (user?.role !== 'guest') return next();
    const readOnly = c.req.method === 'GET' || c.req.method === 'HEAD';
    if (readOnly && GUEST_READ_PATHS.some((re) => re.test(c.req.path))) return next();
    return c.json(
      {
        error: 'guest_forbidden',
        message: 'Convidados têm acesso somente de leitura ao calendário',
      },
      403,
    );
  });
