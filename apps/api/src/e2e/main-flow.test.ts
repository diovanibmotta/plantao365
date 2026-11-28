/**
 * Teste E2E (nível de API) do fluxo principal do Plantão365, task 11.2.
 *
 * Não há navegador: as requisições vão ao app COMPLETO (`createApp`, com CSRF, sessão, hooks de
 * notificação e todos os routers reais) via `app.request`. Login pelo fluxo OIDC com IdP de teste
 * (/auth/login + /auth/callback); e-mails saem pela outbox real (createMailer + startOutboxWorker)
 * para um servidor SMTP de teste em memória. Cenário único encadeado: cada passo depende do anterior.
 */
import { addDays } from '@plantao365/shared';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/index.js';
import { bootstrapManagers } from '../auth/bootstrap.js';
import { STATE_COOKIE } from '../auth/router.js';
import { createApp } from '../app.js';
import { createMailer, startOutboxWorker, type OutboxWorker } from '../email/index.js';
import { startTestSmtp, type CapturedEmail, type TestSmtp } from '../email/test-smtp.js';
import { createLogger } from '../logger.js';
import { createTestIdp, csrfHeaders, TEST_ORIGIN } from '../test-app.js';
import { createEventHandlers } from '../notifications/handlers.js';
import { processDomainEvents } from '../events/index.js';
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../test-utils.js';

const logger = createLogger({ level: 'silent' });
const MANAGER_EMAIL = 'gestor@example.test';
const MEMBERS = [
  { name: 'Ana Souza', email: 'ana@example.test' },
  { name: 'Bruno Lima', email: 'bruno@example.test' },
  { name: 'Carla Dias', email: 'carla@example.test' },
] as const;

interface Shift {
  id: string;
  date: string;
  dayType: string;
  hours: number;
  userId: string | null;
  originalUserId: string | null;
  originalHours: number | null;
}
interface Schedule {
  id: string;
  status: 'draft' | 'published';
  shifts: Shift[];
}
interface Balance {
  total: { planned: number; actual: number; difference: number };
  shifts: { date: string; plannedHours: number; actualHours: number; swapped: boolean }[];
}

const dayMs = 86_400_000;
const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * dayMs).toISOString().slice(0, 10);

describe.skipIf(!TEST_DATABASE_URL)('E2E de API: fluxo principal', () => {
  let t: TestDb;
  let app: Hono;
  let smtp: TestSmtp;
  let worker: OutboxWorker;

  beforeAll(async () => {
    t = await createTestDb();
    smtp = await startTestSmtp();
    const mailer = createMailer(smtp.options, logger);
    worker = startOutboxWorker({ sql: t.sql, mailer, intervalMs: 3_600_000, logger });
    app = createApp({
      logger,
      db: t.sql,
      authOptions: {
        appBaseUrl: TEST_ORIGIN,
        cookieSecure: false,
        sessionTtlSeconds: 3600,
        oidc: {},
      },
      oidcProvider: createTestIdp(),
    });
    await bootstrapManagers(t.sql, [MANAGER_EMAIL]);
  });
  afterAll(async () => {
    await worker?.stop();
    await smtp?.close();
    await t?.drop();
  });

  const call = (
    path: string,
    opts: { method?: string; cookie?: string; body?: unknown } = {},
  ): Promise<Response> =>
    app.request(path, {
      method: opts.method ?? 'GET',
      headers: {
        origin: TEST_ORIGIN,
        ...csrfHeaders,
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });

  const cookiesOf = (res: Response): Record<string, string> =>
    Object.fromEntries(
      res.headers.getSetCookie().map((line) => {
        const pair = line.split(';')[0]!;
        const i = pair.indexOf('=');
        return [pair.slice(0, i), pair.slice(i + 1)];
      }),
    );

  /** Login real pelo fluxo OIDC (IdP de teste): /auth/login emite state+cookie; /auth/callback troca por sessão. */
  async function login(email: string): Promise<string> {
    const start = await app.request('/auth/login');
    expect(start.status).toBe(302);
    const state = cookiesOf(start)[STATE_COOKIE];
    expect(state).toBeTruthy();
    const cb = await app.request(
      `/auth/callback?state=${state}&email=${encodeURIComponent(email)}`,
      { headers: { cookie: `${STATE_COOKIE}=${state}` } },
    );
    expect(cb.status).toBe(302);
    const session = cookiesOf(cb)[SESSION_COOKIE];
    expect(session).toBeTruthy();
    return `${SESSION_COOKIE}=${session}`;
  }

  const json = async <T>(res: Response, status = 200): Promise<T> => {
    const text = await res.text();
    expect(res.status, text).toBe(status);
    return JSON.parse(text) as T;
  };

  async function drainEmails(count: number): Promise<CapturedEmail[]> {
    await processDomainEvents(t.sql, createEventHandlers({ appBaseUrl: TEST_ORIGIN }), {
      maxAttempts: 1,
    });
    await worker.runOnce();
    return [...(await smtp.waitForMessages(count))];
  }

  it('gestor e membros usam o app de ponta a ponta: escala, troca, saldo e e-mails', async () => {
    // 1) gestor loga (IdP de teste) e cadastra 3 membros
    const manager = await login(MANAGER_EMAIL);
    const me = await json<{ email: string; role: string }>(
      await call('/auth/me', { cookie: manager }),
    );
    expect(me).toMatchObject({ email: MANAGER_EMAIL, role: 'manager' });

    const ids = new Map<string, string>();
    for (const m of MEMBERS) {
      const created = await json<{ id: string }>(
        await call('/api/users', {
          method: 'POST',
          cookie: manager,
          body: m,
        }),
        201,
      );
      ids.set(m.email, created.id);
      // papel e rodízio são definidos ao vincular o membro à equipe
      await json(
        await call(`/api/teams/00000000-0000-0000-0000-000000000001/members/${created.id}`, {
          method: 'PUT',
          cookie: manager,
          body: { role: 'member', participatesInRotation: true },
        }),
        200,
      );
    }
    // cada cadastro gera um convite e cada vínculo um aviso de equipe; confere e zera a caixa
    const welcome = await drainEmails(MEMBERS.length * 2);
    const invites = welcome.filter((m) => m.subject === 'Você foi convidado para o Plantão365');
    expect(invites).toHaveLength(MEMBERS.length);
    expect(invites.flatMap((m) => m.to).sort()).toEqual(MEMBERS.map((m) => m.email).sort());
    const added = welcome.filter((m) => m.subject.startsWith('Você foi adicionado à equipe'));
    expect(added.flatMap((m) => m.to).sort()).toEqual(MEMBERS.map((m) => m.email).sort());
    smtp.clear();

    const cookies = new Map<string, string>();
    for (const m of MEMBERS) cookies.set(m.email, await login(m.email));
    const ana = MEMBERS[0].email;
    const bruno = MEMBERS[1].email;

    // 2) feriado dentro do período futuro
    const from = isoDay(30);
    const to = addDays(from, 6);
    const holidayDate = addDays(from, 2);
    await t.sql`delete from holidays where date = ${holidayDate}::date`;
    await json(
      await call('/api/holidays', {
        method: 'POST',
        cookie: manager,
        body: { date: holidayDate, name: 'Feriado E2E', scope: 'state' },
      }),
      201,
    );

    // 3) gerar rascunho, revisar, editar um plantão, publicar
    const gen = await json<{ schedule: { id: string; status: string }; shifts: Shift[] }>(
      await call('/api/schedules/generate', {
        method: 'POST',
        cookie: manager,
        body: { from, to },
      }),
      201,
    );
    expect(gen.schedule.status).toBe('draft');
    const draftId = gen.schedule.id;
    expect(gen.shifts).toHaveLength(7);

    const memberIds = new Set(ids.values());
    const draft = await json<Schedule>(
      await call(`/api/schedules/${draftId}`, { cookie: manager }),
    );
    expect(draft.shifts.find((s) => s.date === holidayDate)?.dayType).toBe('holiday');
    expect(draft.shifts.every((s) => s.userId && memberIds.has(s.userId))).toBe(true);

    // rascunho invisível ao membro antes da publicação
    expect((await call(`/api/schedules/${draftId}`, { cookie: cookies.get(ana)! })).status).toBe(
      404,
    );

    // edição no rascunho: reatribui o primeiro dia a outro membro
    const first = draft.shifts[0]!;
    const newOwner = [...memberIds].find((id) => id !== first.userId)!;
    await json(
      await call(`/api/schedules/${draftId}/shifts/${first.id}`, {
        method: 'PATCH',
        cookie: manager,
        body: { userId: newOwner },
      }),
    );
    const edited = await json<Schedule>(
      await call(`/api/schedules/${draftId}`, { cookie: manager }),
    );
    expect(edited.shifts.find((s) => s.id === first.id)?.userId).toBe(newOwner);

    let publish = await call(`/api/schedules/${draftId}/publish`, {
      method: 'POST',
      cookie: manager,
      body: {},
    });
    if (publish.status === 409) {
      const body = (await publish.json()) as { error: string };
      expect(body.error).toBe('confirmation_required');
      publish = await call(`/api/schedules/${draftId}/publish`, {
        method: 'POST',
        cookie: manager,
        body: { confirmUnassigned: true },
      });
    }
    expect(publish.status, await publish.clone().text()).toBe(200);

    // 4) membro vê a escala publicada e NÃO vê rascunho
    const second = await json<{ schedule: { id: string } }>(
      await call('/api/schedules/generate', {
        method: 'POST',
        cookie: manager,
        body: { from: addDays(to, 30), to: addDays(to, 32) },
      }),
      201,
    );
    const anaCookie = cookies.get(ana)!;
    const list = await json<{ id: string; status: string }[]>(
      await call('/api/schedules', { cookie: anaCookie }),
    );
    expect(list.map((s) => s.id)).toContain(draftId);
    expect(list.map((s) => s.id)).not.toContain(second.schedule.id);
    expect(list.every((s) => s.status === 'published')).toBe(true);
    expect((await call(`/api/schedules/${second.schedule.id}`, { cookie: anaCookie })).status).toBe(
      404,
    );
    expect(
      (await call(`/api/shifts?status=draft&from=${from}&to=${to}`, { cookie: anaCookie })).status,
    ).toBe(403);
    const published = await json<Schedule>(
      await call(`/api/schedules/${draftId}`, { cookie: anaCookie }),
    );
    expect(published.status).toBe('published');
    expect(published.shifts.find((s) => s.id === first.id)?.userId).toBe(newOwner);
    expect(published.shifts.every((s) => s.originalUserId === s.userId)).toBe(true);

    // e-mail de publicação: um por membro com plantões (capturado pela outbox real)
    const assignees = new Set(published.shifts.map((s) => s.userId!));
    const publishMails = await drainEmails(assignees.size);
    expect(publishMails).toHaveLength(assignees.size);
    expect(publishMails.every((m) => m.subject.startsWith('Escala publicada'))).toBe(true);
    const emailOf = (id: string) => MEMBERS.find((m) => ids.get(m.email) === id)!.email;
    expect(publishMails.flatMap((m) => m.to).sort()).toEqual([...assignees].map(emailOf).sort());
    smtp.clear();

    // 5) troca (permuta): Ana pede ao Bruno, Bruno aceita, gestor aprova
    const anaId = ids.get(ana)!;
    const brunoId = ids.get(bruno)!;
    const anaShift = published.shifts.find((s) => s.userId === anaId);
    const brunoShift = published.shifts.find((s) => s.userId === brunoId);
    expect(anaShift && brunoShift, 'Ana e Bruno precisam ter plantões').toBeTruthy();
    const anaPlanned = published.shifts
      .filter((x) => x.originalUserId === anaId)
      .map((x) => ({ date: x.date, hours: x.originalHours! }));

    // plantão realizado no passado, injetado por SQL, para o saldo ter "realizado"
    const pastDate = isoDay(-10);
    const [pastSchedule] = await t.sql<{ id: string }[]>`
      insert into schedules (start_date, end_date, status, created_by, published_at)
      values (${pastDate}::date, ${pastDate}::date, 'published', ${ids.get(MEMBERS[2].email)!}, now())
      returning id`;
    await t.sql`
      insert into shifts (schedule_id, date, day_type, hours, starts_at, ends_at, user_id,
        original_user_id, original_hours)
      values (${pastSchedule!.id}, ${pastDate}::date, 'weekday', 24,
        ${pastDate + 'T00:00:00Z'}::timestamptz, ${addDays(pastDate, 1) + 'T00:00:00Z'}::timestamptz,
        ${anaId}, ${anaId}, 24)`;

    const brunoCookie = cookies.get(bruno)!;
    const swap = await json<{ swap: { id: string; status: string } }>(
      await call('/api/swaps', {
        method: 'POST',
        cookie: anaCookie,
        body: {
          kind: 'swap',
          shiftId: anaShift!.id,
          counterpartId: brunoId,
          counterpartShiftId: brunoShift!.id,
        },
      }),
      201,
    );
    expect(swap.swap.status).toBe('pending');
    const act = (action: string, cookie: string) =>
      call(`/api/swaps/${swap.swap.id}/${action}`, { method: 'POST', cookie, body: {} });
    // gestor não decide antes do aceite
    expect((await act('approve', manager)).status).toBeGreaterThanOrEqual(400);
    const accepted = await json<{ swap: { status: string } }>(await act('accept', brunoCookie));
    expect(accepted.swap.status).toBe('awaiting_approval');
    const approved = await json<{ swap: { status: string } }>(await act('approve', manager));
    expect(approved.swap.status).toBe('approved');

    const after = await json<Schedule>(
      await call(`/api/schedules/${draftId}`, { cookie: anaCookie }),
    );
    expect(after.shifts.find((s) => s.id === anaShift!.id)?.userId).toBe(brunoId);
    expect(after.shifts.find((s) => s.id === brunoShift!.id)?.userId).toBe(anaId);
    // original_* preservado após a troca
    expect(after.shifts.find((s) => s.id === anaShift!.id)?.originalUserId).toBe(anaId);

    // 6) saldo: previsto segue o original (inalterado pela troca); realizado vem do plantão passado
    const yearOf = (d: string) => Number(d.slice(0, 4));
    const years = new Set([...anaPlanned.map((p) => yearOf(p.date)), yearOf(pastDate)]);
    for (const year of years) {
      const bal = await json<Balance>(
        await call(`/api/me/balance?year=${year}`, { cookie: anaCookie }),
      );
      const pastInYear = yearOf(pastDate) === year ? 24 : 0;
      const expectedPlanned =
        anaPlanned.filter((p) => yearOf(p.date) === year).reduce((a, p) => a + p.hours, 0) +
        pastInYear;
      expect(bal.total.planned).toBe(expectedPlanned);
      expect(bal.total.actual).toBe(pastInYear);
      expect(bal.total.difference).toBe(pastInYear - expectedPlanned);
      if (yearOf(anaShift!.date) === year) {
        const detail = bal.shifts.find((s) => s.date === anaShift!.date);
        expect(detail).toMatchObject({ swapped: true, actualHours: 0 });
        expect(detail!.plannedHours).toBe(anaShift!.originalHours);
      }
    }

    // 7) e-mails de troca: pedido (Bruno), aceite (Ana + gestor), aprovação (Ana + Bruno)
    const swapMails = await drainEmails(5);
    expect(swapMails).toHaveLength(5);
    const bySubject = (re: RegExp) =>
      swapMails.filter((m) => re.test(m.subject)).flatMap((m) => m.to);
    expect(bySubject(/^Pedido de troca de plantão/)).toEqual([bruno]);
    expect(bySubject(/^Pedido de troca aceito/)).toEqual([ana]);
    expect(bySubject(/^Troca aguardando aprovação/)).toEqual([MANAGER_EMAIL]);
    expect(bySubject(/^Troca aprovada/).sort()).toEqual([ana, bruno]);

    // negativo: membro não acessa auditoria nem gera escala; anônimo não acessa nada
    expect((await call('/api/audit', { cookie: anaCookie })).status).toBe(403);
    const forbiddenGenerate = await call('/api/schedules/generate', {
      method: 'POST',
      cookie: anaCookie,
      body: { from: addDays(to, 60), to: addDays(to, 62) },
    });
    expect(forbiddenGenerate.status).toBe(403);
    expect((await call('/api/audit')).status).toBe(401);
    const audit = await json<{ items: { action: string }[] }>(
      await call('/api/audit', { cookie: manager }),
    );
    expect(audit.items.map((i) => i.action)).toEqual(
      expect.arrayContaining(['schedule.generate', 'schedule.publish']),
    );
  }, 60_000);
});
