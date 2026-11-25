import type { Sql } from '../db.js';
import {
  enqueueEmail,
  renderBalanceAdjustedEmail,
  renderInviteEmail,
  renderScheduleGeneratedEmail,
  renderTeamMemberEmail,
  renderUserStatusEmail,
  type RenderedEmail,
} from '../email/index.js';
import type { EventHandlers } from '../events/consumer.js';
import type { DomainEventMap } from '../events/types.js';
import {
  notifySchedulePublished,
  notifyShiftChange,
  notifyShiftsChanged,
} from './schedule-events.js';
import { notifySwapEvent } from './swap-events.js';
import { notifyScheduleImpact } from './impact-events.js';
import { notifyUnavailabilityConflict } from './unavailability-events.js';

export interface HandlerDeps {
  /** URL base do web (APP_BASE_URL); habilita os links de ação nos e-mails. */
  appBaseUrl?: string | undefined;
}

/** Forma mínima de um evento para handlers compartilhados por vários tipos. */
type Ev<P> = { id: string; payload: P };

interface Person {
  id: string;
  name: string;
  email: string;
}

const link = (base: string | undefined, path: string): string | undefined =>
  base ? new URL(path, base).href : undefined;

async function findUser(sql: Sql, id: string, onlyActive: boolean): Promise<Person | undefined> {
  const [row] = await sql<Person[]>`
    select id, name, email from users
    where id = ${id} and not is_master ${onlyActive ? sql`and active` : sql``}`;
  return row;
}

async function teamName(sql: Sql, teamId: string): Promise<string> {
  const [row] = await sql<{ name: string }[]>`select name from teams where id = ${teamId}`;
  return row?.name ?? 'sua equipe';
}

const send = (sql: Sql, to: string, email: RenderedEmail, dedupeKey: string, now: Date) =>
  enqueueEmail(sql, { to, ...email, dedupeKey }, now);

/**
 * Handlers do consumidor: cada evento de domínio vira os e-mails dos seus destinatários. Os
 * `notify*` dos eventos antigos já cuidam de destinatários ativos e da chave de dedupe.
 */
export function createEventHandlers(deps: HandlerDeps = {}): Required<EventHandlers> {
  const { appBaseUrl } = deps;

  const swap = async (tx: Sql, e: Ev<DomainEventMap['swap.requested']>, ctx: { now: Date }) => {
    await notifySwapEvent(tx, e.payload, { appBaseUrl, now: ctx.now });
  };

  return {
    'schedule.published': async (tx, e, ctx) => {
      await notifySchedulePublished(tx, e.payload, { appBaseUrl, now: ctx.now });
    },
    'shift.changed': async (tx, e, ctx) => {
      await notifyShiftChange(tx, e.payload, { appBaseUrl, now: ctx.now, eventId: e.id });
    },
    'shifts.recalculated': async (tx, e, ctx) => {
      await notifyShiftsChanged(tx, e.payload.notices, { appBaseUrl, now: ctx.now });
    },
    'swap.requested': swap,
    'swap.accepted': swap,
    'swap.declined': swap,
    'swap.cancelled': swap,
    'swap.approved': swap,
    'swap.rejected': swap,
    'unavailability.conflict': async (tx, e, ctx) => {
      await notifyUnavailabilityConflict(tx, e.payload, { appBaseUrl, now: ctx.now });
    },

    'schedule.impact': async (tx, e, ctx) => {
      await notifyScheduleImpact(tx, e.payload, { appBaseUrl, now: ctx.now, eventId: e.id });
    },

    'schedule.generated': async (tx, e, ctx) => {
      const p = e.payload;
      const actor = await findUser(tx, p.actorId, false);
      const managers = await tx<Person[]>`
        select u.id, u.name, u.email from users u
        join team_members m on m.user_id = u.id
        where m.team_id = ${p.teamId} and m.role = 'manager'
          and u.active and not u.is_master and u.id <> ${p.actorId}
        order by u.id`;
      if (managers.length === 0) return;
      const email = renderScheduleGeneratedEmail({
        startDate: p.startDate,
        endDate: p.endDate,
        actorName: actor?.name ?? 'Um gestor',
        teamName: await teamName(tx, p.teamId),
        shifts: p.shifts,
        unassignedDates: p.unassignedDates,
        appUrl: link(appBaseUrl, '/schedule-admin'),
      });
      for (const m of managers) {
        await send(tx, m.email, email, `schedule-generated:${p.scheduleId}:${m.id}`, ctx.now);
      }
    },

    'balance.adjusted': async (tx, e, ctx) => {
      const p = e.payload;
      const user = await findUser(tx, p.userId, true);
      if (!user) return;
      const email = renderBalanceAdjustedEmail({
        date: p.date,
        hours: p.hours,
        reason: p.reason,
        appUrl: link(appBaseUrl, '/balance'),
      });
      await send(tx, user.email, email, `balance-adjusted:${p.adjustmentId}`, ctx.now);
    },

    'team.member_added': teamMember('added', deps),
    'team.member_updated': teamMember('updated', deps),
    'team.member_removed': teamMember('removed', deps),

    'user.invited': async (tx, e, ctx) => {
      const user = await findUser(tx, e.payload.userId, true);
      if (!user) return;
      const email = renderInviteEmail({ name: user.name, appUrl: link(appBaseUrl, '/') });
      await send(tx, user.email, email, `invite:${user.id}`, ctx.now);
    },
    'user.activated': userStatus(true, deps),
    'user.deactivated': userStatus(false, deps),
  };
}

function teamMember(kind: 'added' | 'updated' | 'removed', deps: HandlerDeps) {
  return async (tx: Sql, e: Ev<DomainEventMap['team.member_added']>, ctx: { now: Date }) => {
    const p = e.payload;
    const user = await findUser(tx, p.userId, true);
    if (!user) return;
    const email = renderTeamMemberEmail({
      kind,
      teamName: await teamName(tx, p.teamId),
      role: p.role,
      participatesInRotation: p.participatesInRotation,
      appUrl: link(deps.appBaseUrl, '/my-schedule'),
    });
    await send(tx, user.email, email, `team-member-${kind}:${e.id}`, ctx.now);
  };
}

function userStatus(active: boolean, deps: HandlerDeps) {
  return async (tx: Sql, e: Ev<DomainEventMap['user.activated']>, ctx: { now: Date }) => {
    const user = await findUser(tx, e.payload.userId, false);
    if (!user) return;
    const email = renderUserStatusEmail({
      name: user.name,
      active,
      appUrl: link(deps.appBaseUrl, '/'),
    });
    await send(tx, user.email, email, `user-status:${e.id}`, ctx.now);
  };
}
