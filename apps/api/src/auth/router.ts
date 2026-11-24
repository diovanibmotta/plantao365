import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { recordAudit } from '../audit/index.js';
import type { Sql } from '../db.js';
import type { Logger } from '../logger.js';
import { createLoginLimiter, syncMasterUser, verifyMasterCredentials } from './master.js';
import { sessionMiddleware } from './middleware.js';
import {
  createEntraProvider,
  createMockProvider,
  OidcError,
  pkceChallenge,
  type OidcIdentity,
  type OidcProvider,
} from './oidc.js';
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  newToken,
  readSessionToken,
  writeSessionCookie,
} from './sessions.js';
import type { AuthEnv, AuthOptions } from './types.js';

export const STATE_COOKIE = 'p360_oidc_state';
const STATE_TTL_SECONDS = 600;

export interface AuthRouterDeps {
  db: Sql;
  logger: Logger;
  options: AuthOptions;
  /** Permite injetar um IdP (testes); por padrão usa o mock ou o Entra ID conforme as opções. */
  provider?: OidcProvider;
}

type Denial = 'invalid_state' | 'idp_error' | 'invalid_token' | 'inactive' | 'identity_mismatch';

const DENIAL_MESSAGES: Record<Denial, { status: 400 | 403; message: string }> = {
  invalid_state: {
    status: 400,
    message: 'A tentativa de login expirou ou é inválida. Tente entrar novamente.',
  },
  idp_error: { status: 403, message: 'O login não foi concluído. Tente entrar novamente.' },
  invalid_token: {
    status: 403,
    message: 'Não foi possível validar sua identidade. Tente entrar novamente.',
  },
  inactive: {
    status: 403,
    message: 'Seu usuário está inativo. Procure um gestor para reativar o acesso.',
  },
  identity_mismatch: {
    status: 403,
    message: 'Esta conta corporativa não corresponde ao cadastro. Procure um gestor.',
  },
};

/** Mascara o e-mail para logs (a***@dominio); evita PII em claro. */
const maskEmail = (email: string): string => {
  const at = email.lastIndexOf('@');
  return at < 1 ? '***' : `${email[0]}***${email.slice(at)}`;
};

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;

interface UserRow {
  id: string;
  name: string;
  oid: string | null;
  active: boolean;
}

export function createAuthRouter({ db, logger, options, provider }: AuthRouterDeps): Hono<AuthEnv> {
  const { oidc, cookieSecure, sessionTtlSeconds, appBaseUrl } = options;
  if (oidc.mock && process.env['NODE_ENV'] === 'production') {
    throw new Error('OIDC mock não pode ser usado em produção.');
  }
  const idp =
    provider ??
    (oidc.mock
      ? createMockProvider()
      : createEntraProvider(oidc, oidc.redirectUri ?? new URL('/auth/callback', appBaseUrl).href));
  const cookieOptions = { secure: cookieSecure };
  const router = new Hono<AuthEnv>();
  const limiter = createLoginLimiter();

  const deny = (c: Context, reason: Denial, email?: string) => {
    deleteCookie(c, STATE_COOKIE, { path: '/', secure: cookieSecure });
    logger.warn({ reason, email: email ? maskEmail(email) : undefined }, 'login denied');
    const { status, message } = DENIAL_MESSAGES[reason];
    if (c.req.header('accept')?.includes('application/json')) {
      return c.json({ error: reason, message }, status);
    }
    if (c.req.header('accept')?.includes('text/html')) {
      return c.redirect(new URL(`/login?error=${reason}`, appBaseUrl).href);
    }
    return c.html(
      page(
        'Acesso negado',
        `<p>${escapeHtml(message)}</p><p><a href="/auth/login">Tentar novamente</a></p>`,
      ),
      status,
    );
  };

  /** Cria o usuário convidado do primeiro login SSO sem convite; retorna o existente se outra requisição criou antes. */
  const createGuest = async (
    email: string,
    identity: OidcIdentity,
  ): Promise<UserRow | undefined> => {
    const name = identity.name ?? email.split('@')[0] ?? email;
    return db.begin(async (tx) => {
      const [created] = await tx<UserRow[]>`
        insert into users (email, name, role, active, participates_in_rotation, reminders_enabled)
        values (${email}, ${name}, 'guest', true, false, false)
        on conflict (email) do nothing
        returning id, name, oid, active`;
      if (!created) {
        const [existing] = await tx<UserRow[]>`
          select id, name, oid, active from users where email = ${email} and not is_master`;
        return existing;
      }
      await recordAudit(tx, {
        actorId: null,
        action: 'create',
        entityType: 'user',
        entityId: created.id,
        after: { email, role: 'guest', active: true },
        reason: 'primeiro login SSO sem convite',
      });
      return created;
    });
  };

  router.get('/auth/login', async (c) => {
    await db`delete from oidc_login_states where expires_at <= now()`;
    const state = newToken();
    const nonce = newToken();
    const codeVerifier = newToken();
    await db`insert into oidc_login_states (state, nonce, code_verifier, expires_at)
      values (${state}, ${nonce}, ${codeVerifier}, now() + ${STATE_TTL_SECONDS}::int * interval '1 second')`;
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'Lax',
      path: '/',
      maxAge: STATE_TTL_SECONDS,
    });

    if (idp.mock) {
      return c.html(
        page(
          'Login de desenvolvimento (IdP simulado)',
          `<form method="get" action="/auth/callback"><input type="hidden" name="state" value="${escapeHtml(state)}"><label>E-mail <input type="email" name="email" required autofocus></label> <button type="submit">Entrar</button></form>`,
        ),
      );
    }
    try {
      const url = await idp.authorizationUrl({
        state,
        nonce,
        codeChallenge: pkceChallenge(codeVerifier),
      });
      return c.redirect(url.href, 302);
    } catch (err) {
      logger.error({ err }, 'oidc authorization url failed');
      return c.json({ error: 'idp_unavailable', message: 'Login indisponível no momento.' }, 502);
    }
  });

  router.get('/auth/callback', async (c) => {
    const params = new URL(c.req.url).searchParams;
    const state = params.get('state');
    const cookieState = getCookie(c, STATE_COOKIE);
    if (!state || !cookieState || state !== cookieState) return deny(c, 'invalid_state');

    const [stored] = await db<{ nonce: string; code_verifier: string }[]>`
      delete from oidc_login_states where state = ${state} and expires_at > now()
      returning nonce, code_verifier`;
    if (!stored) return deny(c, 'invalid_state');
    if (params.has('error')) return deny(c, 'idp_error');

    let identity: OidcIdentity;
    try {
      identity = await idp.exchange(params, {
        state,
        nonce: stored.nonce,
        codeVerifier: stored.code_verifier,
      });
    } catch (err) {
      if (!(err instanceof OidcError)) logger.error({ err }, 'oidc exchange failed');
      return deny(c, 'invalid_token');
    }

    const email = identity.email.toLowerCase();
    let [user] = await db<
      UserRow[]
    >`select id, name, oid, active from users where email = ${email} and not is_master`;
    if (!user) {
      // Sem convite: entra como convidado (somente leitura do calendário).
      user = await createGuest(email, identity);
      if (!user) return deny(c, 'inactive', email);
    }
    if (!user.active) return deny(c, 'inactive', email);
    if (user.oid && user.oid !== identity.oid) return deny(c, 'identity_mismatch', email);

    const newOid = user.oid ? null : identity.oid;
    const newName = identity.name && identity.name !== user.name ? identity.name : null;
    if (newOid || newName) {
      await db.begin(async (tx) => {
        await tx`update users set oid = coalesce(oid, ${identity.oid}),
          name = coalesce(${newName}, name), updated_at = now()
          where id = ${user.id}`;
        await recordAudit(tx, {
          actorId: user.id,
          action: 'user.link_identity',
          entityType: 'user',
          entityId: user.id,
          before: { oidLinked: user.oid !== null, name: user.name },
          after: { oidLinked: true, name: newName ?? user.name },
          reason: 'primeiro acesso',
        });
      });
    }

    if (identity.photo !== undefined) {
      await db`update users set photo = ${identity.photo?.data ?? null},
        photo_type = ${identity.photo?.type ?? null} where id = ${user.id}`;
    }

    const { token } = await createSession(db, user.id, sessionTtlSeconds);
    deleteCookie(c, STATE_COOKIE, { path: '/', secure: cookieSecure });
    writeSessionCookie(c, token, sessionTtlSeconds, cookieOptions);
    logger.info({ userId: user.id }, 'login succeeded');
    return c.redirect(appBaseUrl, 302);
  });

  router.get('/auth/config', (c) => c.json({ masterLogin: options.master !== undefined }));

  router.post('/auth/master-login', async (c) => {
    const master = options.master;
    if (!master) return c.json({ error: 'master_disabled' }, 404);
    if (limiter.blocked()) {
      logger.warn('master login blocked: too many failures');
      return c.json(
        { error: 'too_many_attempts', message: 'Muitas tentativas. Aguarde alguns minutos.' },
        429,
      );
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      !verifyMasterCredentials(master, username, password)
    ) {
      limiter.fail();
      logger.warn('master login denied');
      return c.json({ error: 'invalid_credentials', message: 'Usuário ou senha inválidos.' }, 401);
    }
    limiter.reset();
    const userId = await syncMasterUser(db, master);
    if (!userId) return c.json({ error: 'master_disabled' }, 404);
    await recordAudit(db, {
      actorId: userId,
      action: 'master.login',
      entityType: 'user',
      entityId: userId,
    });
    const { token } = await createSession(db, userId, sessionTtlSeconds);
    writeSessionCookie(c, token, sessionTtlSeconds, cookieOptions);
    logger.info({ userId }, 'master login succeeded');
    return c.json({ ok: true });
  });

  router.post('/auth/logout', async (c) => {
    const token = readSessionToken(c);
    if (token) await deleteSession(db, token);
    clearSessionCookie(c, cookieOptions);
    return c.json({ ok: true });
  });

  router.get('/auth/me', sessionMiddleware({ db, cookieOptions }), (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'unauthenticated' }, 401);
    return c.json(user);
  });

  return router;
}
