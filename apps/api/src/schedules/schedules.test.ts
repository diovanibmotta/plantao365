import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { loadMigrations, migrateDown, migrateUp } from '../migrator.js';
import { buildTestApp, loginAs, type TestUser } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createSchedulesRouter } from './router.js';
import { countPublishedShiftsOnDates, findPublishedShiftsForUser, getSchedule } from './service.js';

const get = (app: ReturnType<typeof buildTestApp>, url: string, user?: TestUser) =>
  app.request(url, { headers: user ? { cookie: user.cookie } : {} });

async function insertSchedule(
  sql: Sql,
  createdBy: string,
  status: 'draft' | 'published',
  start: string,
  end: string,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into schedules (start_date, end_date, status, created_by, published_at)
    values (${start}::date, ${end}::date, ${status}, ${createdBy},
      ${status === 'published' ? sql`now()` : null})
    returning id`;
  return row!.id;
}

async function insertShift(
  sql: Sql,
  scheduleId: string,
  date: string,
  userId: string | null,
  extra: { dayType?: string; hours?: number; startsAt?: string; endsAt?: string } = {},
): Promise<void> {
  await sql`
    insert into shifts (schedule_id, date, day_type, hours, starts_at, ends_at, user_id,
      original_user_id, original_hours)
    values (${scheduleId}, ${date}::date, ${extra.dayType ?? 'weekday'}, ${extra.hours ?? 14},
      ${extra.startsAt ?? null}, ${extra.endsAt ?? null}, ${userId}, ${userId},
      ${extra.hours ?? 14})`;
}

describe.skipIf(!process.env['TEST_DATABASE_URL'])('schedules (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let app: ReturnType<typeof buildTestApp>;
  let manager: TestUser;
  let ana: TestUser;
  let bia: TestUser;
  let published: string;
  let draft: string;

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
    app = buildTestApp(sql, (a) => a.route('/', createSchedulesRouter({ db: sql })));
    manager = await loginAs(sql, { email: 'g@x.com', role: 'manager', name: 'Gestor' });
    ana = await loginAs(sql, { email: 'ana@x.com', name: 'Ana' });
    bia = await loginAs(sql, { email: 'bia@x.com', name: 'Bia' });

    published = await insertSchedule(sql, manager.id, 'published', '2026-03-01', '2026-03-05');
    draft = await insertSchedule(sql, manager.id, 'draft', '2026-04-01', '2026-04-03');
    await insertShift(sql, published, '2026-03-01', ana.id, {
      dayType: 'weekend',
      hours: 24,
      startsAt: '2026-03-01T11:00:00Z',
      endsAt: '2026-03-02T11:00:00Z',
    });
    await insertShift(sql, published, '2026-03-02', bia.id);
    await insertShift(sql, published, '2026-03-03', null);
    await insertShift(sql, published, '2026-03-04', ana.id);
    await insertShift(sql, draft, '2026-04-01', ana.id);
    await insertShift(sql, draft, '2026-04-02', bia.id);
  });
  afterAll(async () => {
    await t.drop();
  });

  it('exige autenticação', async () => {
    for (const url of [
      '/schedules',
      `/schedules/${published}`,
      '/shifts?from=2026-03-01&to=2026-03-02',
      '/shifts/mine?from=2026-03-01&to=2026-03-02',
    ]) {
      expect((await get(app, url)).status).toBe(401);
    }
  });

  it('membro lista só escalas publicadas; gestor vê todas', async () => {
    const asMember = (await (await get(app, '/schedules', ana)).json()) as { id: string }[];
    expect(asMember.map((s) => s.id)).toEqual([published]);
    const asManager = (await (await get(app, '/schedules', manager)).json()) as { id: string }[];
    expect(asManager.map((s) => s.id).sort()).toEqual([published, draft].sort());
  });

  it('detalhe devolve escala e plantões com datas sem deslocamento de fuso', async () => {
    const res = await get(app, `/schedules/${published}`, ana);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      startDate: string;
      endDate: string;
      status: string;
      shifts: Record<string, unknown>[];
    };
    expect(body.startDate).toBe('2026-03-01');
    expect(body.endDate).toBe('2026-03-05');
    expect(body.status).toBe('published');
    expect(body.shifts.map((s) => s['date'])).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
    ]);
    expect(body.shifts[0]).toMatchObject({
      scheduleId: published,
      dayType: 'weekend',
      hours: 24,
      startsAt: '2026-03-01T11:00:00.000Z',
      endsAt: '2026-03-02T11:00:00.000Z',
      userId: ana.id,
      userName: 'Ana',
      originalUserId: ana.id,
      originalHours: 24,
    });
    expect(body.shifts[2]).toMatchObject({ userId: null, userName: null });
  });

  it('rascunho: 404 para membro, 200 para gestor; id inválido ou inexistente é 404', async () => {
    expect((await get(app, `/schedules/${draft}`, ana)).status).toBe(404);
    const res = await get(app, `/schedules/${draft}`, manager);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { shifts: unknown[] }).shifts).toHaveLength(2);
    expect((await get(app, '/schedules/nao-e-uuid', manager)).status).toBe(404);
    expect(
      (await get(app, '/schedules/00000000-0000-4000-8000-000000000000', manager)).status,
    ).toBe(404);
  });

  it('/shifts oculta rascunho do membro e filtra por período e usuário', async () => {
    const all = (await (await get(app, '/shifts?from=2026-03-01&to=2026-04-30', ana)).json()) as {
      date: string;
    }[];
    expect(all.map((s) => s.date)).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
    ]);

    const period = (await (
      await get(app, '/shifts?from=2026-03-02&to=2026-03-03', ana)
    ).json()) as { date: string }[];
    expect(period.map((s) => s.date)).toEqual(['2026-03-02', '2026-03-03']);

    const byUser = (await (
      await get(app, `/shifts?from=2026-03-01&to=2026-03-31&userId=${bia.id}`, ana)
    ).json()) as { userName: string }[];
    expect(byUser).toHaveLength(1);
    expect(byUser[0]!.userName).toBe('Bia');
  });

  it('/shifts: membro não pode pedir rascunho; gestor escolhe o status', async () => {
    expect((await get(app, '/shifts?from=2026-04-01&to=2026-04-30&status=draft', ana)).status).toBe(
      403,
    );
    expect((await get(app, '/shifts?from=2026-04-01&to=2026-04-30&status=all', ana)).status).toBe(
      403,
    );
    const defaults = (await (
      await get(app, '/shifts?from=2026-03-01&to=2026-04-30', manager)
    ).json()) as unknown[];
    expect(defaults).toHaveLength(4);
    const drafts = (await (
      await get(app, '/shifts?from=2026-03-01&to=2026-04-30&status=draft', manager)
    ).json()) as { scheduleId: string }[];
    expect(drafts).toHaveLength(2);
    expect(drafts.every((s) => s.scheduleId === draft)).toBe(true);
    const everything = (await (
      await get(app, '/shifts?from=2026-03-01&to=2026-04-30&status=all', manager)
    ).json()) as unknown[];
    expect(everything).toHaveLength(6);
  });

  it('/shifts/mine devolve só os plantões publicados do usuário logado', async () => {
    const res = await get(app, '/shifts/mine?from=2026-03-01&to=2026-04-30', ana);
    expect(res.status).toBe(200);
    const mine = (await res.json()) as { date: string; userId: string }[];
    expect(mine.map((s) => s.date)).toEqual(['2026-03-01', '2026-03-04']);
    expect(mine.every((s) => s.userId === ana.id)).toBe(true);
    const gestor = (await (
      await get(app, '/shifts/mine?from=2026-03-01&to=2026-04-30', manager)
    ).json()) as unknown[];
    expect(gestor).toEqual([]);
  });

  it('valida filtros com 400', async () => {
    const bad = [
      '/shifts',
      '/shifts?from=2026-03-01',
      '/shifts?from=2026-02-30&to=2026-03-01',
      '/shifts?from=2026-3-1&to=2026-03-02',
      '/shifts?from=2026-03-05&to=2026-03-01',
      '/shifts?from=2026-01-01&to=2027-01-02',
      '/shifts?from=2026-03-01&to=2026-03-02&userId=abc',
      '/shifts?from=2026-03-01&to=2026-03-02&status=x',
      '/shifts/mine?from=2026-03-05&to=2026-03-01',
    ];
    for (const url of bad) {
      const res = await get(app, url, manager);
      expect(res.status, url).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('invalid_filters');
    }
    expect((await get(app, '/shifts?from=2026-01-01&to=2027-01-01', manager)).status).toBe(200);
  });

  it('getSchedule, countPublishedShiftsOnDates e findPublishedShiftsForUser', async () => {
    expect(await getSchedule(sql, published)).toMatchObject({ startDate: '2026-03-01' });
    expect(await getSchedule(sql, '00000000-0000-4000-8000-000000000000')).toBeNull();

    expect(
      await countPublishedShiftsOnDates(sql, [
        '2026-03-01',
        '2026-03-03',
        '2026-04-01',
        '2026-05-01',
      ]),
    ).toEqual([
      { date: '2026-03-01', count: 1 },
      { date: '2026-03-03', count: 1 },
    ]);
    expect(await countPublishedShiftsOnDates(sql, [])).toEqual([]);

    expect(
      await findPublishedShiftsForUser(sql, {
        userId: ana.id,
        start: '2026-03-01',
        end: '2026-04-30',
      }),
    ).toEqual([
      { date: '2026-03-01', userId: ana.id },
      { date: '2026-03-04', userId: ana.id },
    ]);
    expect(
      await findPublishedShiftsForUser(sql, {
        userId: null,
        start: '2026-03-01',
        end: '2026-04-30',
      }),
    ).toEqual([{ date: '2026-03-03', userId: null }]);
  });

  it('impõe restrições do esquema', async () => {
    await expect(
      insertSchedule(sql, manager.id, 'published', '2026-05-10', '2026-05-01'),
    ).rejects.toThrow();
    await expect(insertShift(sql, published, '2026-03-01', null)).rejects.toThrow();
    await expect(insertShift(sql, published, '2026-03-05', null, { hours: 10 })).rejects.toThrow();
  });

  it('apagar a escala remove seus plantões em cascata', async () => {
    const id = await insertSchedule(sql, manager.id, 'draft', '2026-06-01', '2026-06-02');
    await insertShift(sql, id, '2026-06-01', ana.id);
    await sql`delete from schedules where id = ${id}`;
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from shifts where schedule_id = ${id}`;
    expect(n).toBe(0);
  });
});

describe.skipIf(!process.env['TEST_DATABASE_URL'])('migração 0007_schedules', () => {
  it('reverte e reaplica', async () => {
    const t = await createTestDb({ migrate: false });
    try {
      const migrations = await loadMigrations(
        path.resolve(import.meta.dirname, '../../migrations'),
      );
      await migrateUp(t.sql, migrations);
      const tables = () =>
        t.sql<{ table_name: string }[]>`
          select table_name from information_schema.tables
          where table_schema = 'public' and table_name in ('schedules', 'shifts')
          order by table_name`;
      expect((await tables()).map((r) => r.table_name)).toEqual(['schedules', 'shifts']);
      await migrateDown(t.sql, migrations, 'all');
      expect(await tables()).toEqual([]);
      await migrateUp(t.sql, migrations);
      expect(await tables()).toHaveLength(2);
    } finally {
      await t.drop();
    }
  });
});
