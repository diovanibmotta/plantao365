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

    const ze = await loginAs(sql, { email: 'ze@x.com', name: 'Zé' });
    await sql`delete from team_members where user_id = ${ze.id}`;
    expect((await call('PUT', `/teams/${id}/members/${ze.id}`, gestor.cookie)).status).toBe(200);
    const inTeam = (await (await call('GET', `/teams/${id}/members`, gestor.cookie)).json()) as {
      email: string;
    }[];
    expect(inTeam.map((u) => u.email)).toEqual(['g2@x.com', 'ze@x.com']);
    const inDefault = (await (
      await call('GET', `/teams/${DEFAULT_TEAM_ID}/members`, gestor.cookie)
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

  it('renomeia e exclui equipe; recusa nome repetido, equipe alheia e equipe com escalas', async () => {
    const gestor = await loginAs(sql, { email: 'g4@x.com', role: 'manager' });
    const mk = async (name: string) =>
      (
        (await (await call('POST', '/teams', gestor.cookie, undefined, { name })).json()) as {
          id: string;
        }
      ).id;
    const a = await mk('Alfa');
    const b = await mk('Beta');

    const ok = await call('PATCH', `/teams/${a}`, gestor.cookie, undefined, { name: 'Alfa 2' });
    expect(ok.status).toBe(200);
    const dup = await call('PATCH', `/teams/${a}`, gestor.cookie, undefined, { name: 'beta' });
    expect(dup.status).toBe(409);

    const outro = await loginAs(sql, { email: 'o4@x.com', role: 'manager' });
    expect((await call('DELETE', `/teams/${a}`, outro.cookie)).status).toBe(404);
    expect((await call('DELETE', `/teams/${DEFAULT_TEAM_ID}`, gestor.cookie)).status).toBe(409);

    await call('POST', '/schedules/generate', gestor.cookie, b, {
      from: '2026-12-01',
      to: '2026-12-03',
    });
    expect((await call('DELETE', `/teams/${b}`, gestor.cookie)).status).toBe(409);

    expect((await call('DELETE', `/teams/${a}`, gestor.cookie)).status).toBe(204);
    const list = (await (await call('GET', '/teams', gestor.cookie)).json()) as { id: string }[];
    expect(list.map((x) => x.id)).not.toContain(a);
  });

  it('pré-cadastro não vincula a nenhuma equipe e recusa e-mail repetido', async () => {
    const gestor = await loginAs(sql, { email: 'g3@x.com', role: 'manager' });
    const res = await call('POST', '/users', gestor.cookie, undefined, {
      name: 'Pré',
      email: 'pre@x.com',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ teamIds: [] });
    const again = await call('POST', '/users', gestor.cookie, undefined, {
      name: 'Pré',
      email: 'pre@x.com',
    });
    expect(again.status).toBe(409);
  });

  it('salva URL do dashboard e ícone; recusa URL inválida', async () => {
    const gestor = await loginAs(sql, { email: 'g6@x.com', role: 'manager' });
    const ok = await call('POST', '/teams', gestor.cookie, undefined, {
      name: 'Perfil',
      dashboardUrl: 'https://grafana.x/d/1',
      avatar: '🚀',
    });
    expect(ok.status).toBe(201);
    const team = (await ok.json()) as { id: string };
    expect(team).toMatchObject({ dashboardUrl: 'https://grafana.x/d/1', avatar: '🚀' });
    const bad = await call('PATCH', `/teams/${team.id}`, gestor.cookie, undefined, {
      name: 'Perfil',
      dashboardUrl: 'javascript:alert(1)',
    });
    expect(bad.status).toBe(400);
    const cleared = await call('PATCH', `/teams/${team.id}`, gestor.cookie, undefined, {
      name: 'Perfil',
    });
    expect(await cleared.json()).toMatchObject({ dashboardUrl: null, avatar: null });
  });

  it('gestor vincula e desvincula membro; recusa equipe alheia e retorna teamIds', async () => {
    const gestor = await loginAs(sql, { email: 'g5@x.com', role: 'manager' });
    const { id } = (await (
      await call('POST', '/teams', gestor.cookie, undefined, { name: 'Vínculos' })
    ).json()) as { id: string };
    const alvo = await loginAs(sql, { email: 'alvo@x.com' });

    const linked = await call('PUT', `/teams/${id}/members/${alvo.id}`, gestor.cookie);
    expect(linked.status).toBe(200);
    expect(await linked.json()).toMatchObject({ role: 'member', participatesInRotation: true });
    // idempotente
    expect((await call('PUT', `/teams/${id}/members/${alvo.id}`, gestor.cookie)).status).toBe(200);
    const members = (await (await call('GET', `/teams/${id}/members`, gestor.cookie)).json()) as {
      email: string;
    }[];
    expect(members.map((m) => m.email)).toContain('alvo@x.com');
    const users = (await (await call('GET', '/users', gestor.cookie, id)).json()) as {
      email: string;
      teamIds: string[];
    }[];
    expect(users.find((u) => u.email === 'alvo@x.com')?.teamIds).toContain(id);

    const outro = await loginAs(sql, { email: 'o5@x.com', role: 'manager' });
    expect((await call('PUT', `/teams/${id}/members/${alvo.id}`, outro.cookie)).status).toBe(404);
    expect((await call('DELETE', `/teams/${id}/members/${alvo.id}`, outro.cookie)).status).toBe(
      404,
    );

    expect((await call('DELETE', `/teams/${id}/members/${alvo.id}`, gestor.cookie)).status).toBe(
      204,
    );
    expect((await call('DELETE', `/teams/${id}/members/${alvo.id}`, gestor.cookie)).status).toBe(
      404,
    );
  });

  it('papel e rodízio são por equipe; promove convidado e protege o último gestor', async () => {
    const gestor = await loginAs(sql, { email: 'g7@x.com', role: 'manager' });
    const { id } = (await (
      await call('POST', '/teams', gestor.cookie, undefined, { name: 'Papéis' })
    ).json()) as { id: string };
    const [pre] = await sql<{ id: string }[]>`
      insert into users (name, email, role, participates_in_rotation)
      values ('Pré', 'pre7@x.com', 'guest', false) returning id`;
    const linked = await call('PUT', `/teams/${id}/members/${pre!.id}`, gestor.cookie, undefined, {
      role: 'manager',
      participatesInRotation: false,
    });
    expect(await linked.json()).toMatchObject({ role: 'manager', participatesInRotation: false });
    const [{ role }] = await sql<{ role: string }[]>`select role from users where id = ${pre!.id}`;
    expect(role).toBe('manager');

    // gestor numa equipe, membro na outra
    const [{ role: inDefault }] = await sql<{ role: string }[]>`
      select role from team_members where team_id = ${DEFAULT_TEAM_ID} and user_id = ${gestor.id}`;
    expect(inDefault).toBe('manager');
    const demoted = await call('PUT', `/teams/${id}/members/${pre!.id}`, gestor.cookie, undefined, {
      role: 'member',
    });
    expect(demoted.status).toBe(200);
    const last = await call('PUT', `/teams/${id}/members/${gestor.id}`, gestor.cookie, undefined, {
      role: 'member',
    });
    expect(last.status).toBe(409);
    expect(((await last.json()) as { error: string }).error).toBe('last_manager');
    expect((await call('DELETE', `/teams/${id}/members/${gestor.id}`, gestor.cookie)).status).toBe(
      409,
    );

    const bad = await call('PUT', `/teams/${id}/members/${pre!.id}`, gestor.cookie, undefined, {
      role: 'guest',
    });
    expect(bad.status).toBe(400);
  });

  it('o papel vale na equipe ativa da requisição', async () => {
    const gestor = await loginAs(sql, { email: 'g8@x.com', role: 'manager' });
    const { id } = (await (
      await call('POST', '/teams', gestor.cookie, undefined, { name: 'Ativa' })
    ).json()) as { id: string };
    const alvo = await loginAs(sql, { email: 'alvo8@x.com' });
    await call('PUT', `/teams/${id}/members/${alvo.id}`, gestor.cookie, undefined, {
      role: 'manager',
    });
    // gestor em Ativa, membro na equipe principal
    await sql`update team_members set role = 'member'
      where team_id = ${DEFAULT_TEAM_ID} and user_id = ${alvo.id}`;
    expect((await call('GET', '/users', alvo.cookie, id)).status).toBe(200);
    expect((await call('GET', '/users', alvo.cookie, DEFAULT_TEAM_ID)).status).toBe(403);
    const teams = (await (await call('GET', '/teams', alvo.cookie)).json()) as {
      id: string;
      role: string;
    }[];
    expect(teams.find((x) => x.id === id)?.role).toBe('manager');
    expect(teams.find((x) => x.id === DEFAULT_TEAM_ID)?.role).toBe('member');
  });
});
