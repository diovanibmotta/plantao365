import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { buildTestApp, csrfHeaders, DEFAULT_TEAM_ID, loginAs, TEST_ORIGIN } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createSchedulesRouter } from '../schedules/index.js';
import { createUsersRouter } from '../users/index.js';
import { createTeamsRouter } from './router.js';

describe.skipIf(!process.env['TEST_DATABASE_URL'])('equipes (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let app: ReturnType<typeof buildTestApp>;

  const call = (method: string, path: string, cookie: string, team?: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        cookie,
        origin: TEST_ORIGIN,
        ...csrfHeaders,
        ...(team ? { 'x-team-id': team } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
    app = buildTestApp(sql, (a) => {
      a.route('/', createTeamsRouter({ db: sql }));
      a.route('/', createUsersRouter({ db: sql }));
      a.route('/', createSchedulesRouter({ db: sql }));
    });
  });
  afterAll(async () => {
    await t.drop();
  });

  it('lista só as equipes do usuário e recusa equipe alheia', async () => {
    const gestor = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
    const created = await call('POST', '/teams', gestor.cookie, undefined, { name: 'Infra' });
    expect(created.status).toBe(201);
    const infra = (await created.json()) as { id: string };

    const outro = await loginAs(sql, { email: 'o@x.com', role: 'manager' });
    const list = (await (await call('GET', '/teams', outro.cookie)).json()) as { id: string }[];
    expect(list.map((x) => x.id)).toEqual([DEFAULT_TEAM_ID]);

    expect(
      (await call('GET', '/shifts?from=2026-01-01&to=2026-01-02', outro.cookie, infra.id)).status,
    ).toBe(403);
    expect(
      (await call('GET', '/shifts?from=2026-01-01&to=2026-01-02', gestor.cookie, infra.id)).status,
    ).toBe(200);
  });

  it('isola membros e escalas por equipe', async () => {
    const gestor = await loginAs(sql, { email: 'g2@x.com', role: 'manager' });
    const { id } = (await (
      await call('POST', '/teams', gestor.cookie, undefined, { name: 'Dados' })
    ).json()) as { id: string };

    await call('POST', '/users', gestor.cookie, id, { name: 'Zé', email: 'ze@x.com' });
    const inTeam = (await (await call('GET', '/users', gestor.cookie, id)).json()) as {
      email: string;
    }[];
    expect(inTeam.map((u) => u.email)).toEqual(['g2@x.com', 'ze@x.com']);
    const inDefault = (await (
      await call('GET', '/users', gestor.cookie, DEFAULT_TEAM_ID)
    ).json()) as { email: string }[];
    expect(inDefault.map((u) => u.email)).not.toContain('ze@x.com');

    const gen = await call('POST', '/schedules/generate', gestor.cookie, id, {
      from: '2026-12-01',
      to: '2026-12-03',
    });
    expect(gen.status).toBe(201);
    const inOther = (await (
      await call('GET', '/schedules', gestor.cookie, DEFAULT_TEAM_ID)
    ).json()) as unknown[];
    expect(inOther).toHaveLength(0);
    const own = (await (await call('GET', '/schedules', gestor.cookie, id)).json()) as unknown[];
    expect(own).toHaveLength(1);
  });

  it('vincula usuário existente de outra equipe em vez de duplicar', async () => {
    const gestor = await loginAs(sql, { email: 'g3@x.com', role: 'manager' });
    const { id } = (await (
      await call('POST', '/teams', gestor.cookie, undefined, { name: 'Suporte' })
    ).json()) as { id: string };
    await loginAs(sql, { email: 'dup@x.com' });
    const res = await call('POST', '/users', gestor.cookie, id, {
      name: 'Dup',
      email: 'dup@x.com',
    });
    expect(res.status).toBe(201);
    const again = await call('POST', '/users', gestor.cookie, id, {
      name: 'Dup',
      email: 'dup@x.com',
    });
    expect(again.status).toBe(409);
  });
});
