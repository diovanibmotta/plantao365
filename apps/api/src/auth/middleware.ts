import { createMiddleware } from 'hono/factory';
import type { Sql } from '../db.js';
import { loadSessionUser, readSessionToken } from './sessions.js';
import type { AuthEnv, SessionCookieOptions } from './types.js';

export interface SessionMiddlewareDeps {
  db: Sql;
  cookieOptions: SessionCookieOptions;
}

/** Carrega o usuário da sessão em `c.var.user` (null quando não autenticado); não bloqueia. */
export function sessionMiddleware({ db }: SessionMiddlewareDeps) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const token = readSessionToken(c);
    c.set('user', token ? await loadSessionUser(db, token) : null);
    await next();
  });
}
