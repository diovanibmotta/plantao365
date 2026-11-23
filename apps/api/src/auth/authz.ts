import { createMiddleware } from 'hono/factory';
import type { AuthEnv, Role } from './types.js';

/** Exige sessão válida; sem usuário responde 401. */
export const requireAuth = () =>
  createMiddleware<AuthEnv>(async (c, next) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
    await next();
  });

/** Exige sessão e papel suficiente: 'manager' só gestor; 'member' qualquer usuário autenticado. */
export const requireRole = (role: Role) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'unauthenticated' }, 401);
    if (role === 'manager' && user.role !== 'manager') return c.json({ error: 'forbidden' }, 403);
    await next();
  });
