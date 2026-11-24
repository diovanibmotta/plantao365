import { createHash, randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Sql } from '../db.js';
import type { AuthUser, Role, SessionCookieOptions } from './types.js';

export const SESSION_COOKIE = 'p360_session';

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const newToken = (): string => randomBytes(32).toString('base64url');

export async function createSession(
  db: Sql,
  userId: string,
  ttlSeconds: number,
): Promise<{ token: string }> {
  const token = newToken();
  await db`insert into sessions (id, user_id, expires_at)
    values (${hashToken(token)}, ${userId}, now() + ${ttlSeconds}::int * interval '1 second')`;
  return { token };
}

export async function deleteSession(db: Sql, token: string): Promise<void> {
  await db`delete from sessions where id = ${hashToken(token)}`;
}

interface SessionRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_master: boolean;
  phone: string | null;
  participates_in_rotation: boolean;
  reminders_enabled: boolean;
  active: boolean;
  expired: boolean;
}

/** Resolve o usuário da sessão; sessões expiradas são removidas e usuário inativo é recusado. */
export async function loadSessionUser(db: Sql, token: string): Promise<AuthUser | null> {
  const id = hashToken(token);
  const [row] = await db<SessionRow[]>`
    select u.id, u.email, u.name, u.role, u.phone, u.participates_in_rotation,
           u.reminders_enabled, u.is_master, u.active, s.expires_at <= now() as expired
    from sessions s join users u on u.id = s.user_id
    where s.id = ${id}`;
  if (!row) return null;
  if (row.expired) {
    await db`delete from sessions where id = ${id}`;
    return null;
  }
  if (!row.active) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    phone: row.phone,
    participatesInRotation: row.participates_in_rotation,
    remindersEnabled: row.reminders_enabled,
    isMaster: row.is_master,
  };
}

export function readSessionToken(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function writeSessionCookie(
  c: Context,
  token: string,
  ttlSeconds: number,
  { secure }: SessionCookieOptions,
): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: ttlSeconds,
  });
}

export function clearSessionCookie(c: Context, { secure }: SessionCookieOptions): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure });
}
