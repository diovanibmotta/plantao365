import { Hono } from 'hono';
import { csrfProtection, sessionMiddleware, SESSION_COOKIE } from './auth/index.js';
import type { AuthEnv } from './auth/index.js';
import { createSession } from './auth/sessions.js';
import type { Sql } from './db.js';
import { teamMiddleware } from './teams/index.js';
import { OidcError, type OidcProvider } from './auth/oidc.js';

export const TEST_ORIGIN = 'http://localhost:5173';

/** Headers exigidos pelo CSRF em métodos não seguros. */
export const csrfHeaders = { 'x-requested-with': 'plantao360' } as const;

export interface TestUser {
  id: string;
  cookie: string;
}

/** Cria um usuário (ativo por padrão) e uma sessão; devolve o header Cookie pronto. */
/** Equipe criada pela migração 0015; os usuários de teste entram nela. */
export const DEFAULT_TEAM_ID = '00000000-0000-0000-0000-000000000001';

export async function loginAs(
  sql: Sql,
  opts: {
    email: string;
    role?: 'manager' | 'member';
    name?: string;
    active?: boolean;
    participatesInRotation?: boolean;
  },
): Promise<TestUser> {
  const [u] = await sql<{ id: string }[]>`
    insert into users (email, name, role, active, participates_in_rotation)
    values (${opts.email}, ${opts.name ?? 'Fulano'}, ${opts.role ?? 'member'},
      ${opts.active ?? true}, ${opts.participatesInRotation ?? true})
    returning id`;
  await sql`insert into team_members (team_id, user_id) values (${DEFAULT_TEAM_ID}, ${u!.id})`;
  const { token } = await createSession(sql, u!.id, 3600);
  return { id: u!.id, cookie: `${SESSION_COOKIE}=${token}` };
}

/**
 * App de teste com CSRF e sessão reais, para exercitar o router de um módulo isolado.
 * O router é montado na raiz (as rotas de produção ficam sob /api, montadas em app.ts).
 */
export function buildTestApp(sql: Sql, mount: (app: Hono<AuthEnv>) => void): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use(csrfProtection({ allowedOrigins: [TEST_ORIGIN] }));
  app.use(sessionMiddleware({ db: sql, cookieOptions: { secure: false } }));
  app.use(teamMiddleware({ db: sql }));
  mount(app);
  return app;
}

/** IdP de teste: o e-mail vem do parâmetro `email` do callback; só existe nos testes. */
export function createTestIdp(): OidcProvider {
  return {
    authorizationUrl: ({ state }) =>
      Promise.resolve(new URL(`https://idp.test/authorize?state=${state}`)),
    exchange(params, { state }) {
      if (params.get('state') !== state) throw new OidcError('Estado inválido.');
      const email = params.get('email')?.trim().toLowerCase();
      if (!email?.includes('@')) throw new OidcError('Informe um e-mail válido.');
      return Promise.resolve({ email, name: undefined, oid: `test:${email}` });
    },
  };
}
