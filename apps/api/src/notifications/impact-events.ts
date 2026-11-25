import { enqueueEmail, renderScheduleImpactEmail } from '../email/index.js';
import type { Sql } from '../db.js';
import type { ScheduleImpactPayload } from '../schedule-impact/types.js';

/**
 * Regra core: avisa por e-mail (outbox) os gestores ativos de cada equipe cujo plantão publicado
 * foi atingido por uma alteração de férias, exceção, feriado ou horário, para recalcular/ajustar a
 * escala. Inclui o autor, quando gestor. A chave de dedupe usa o id do evento: reprocessar o mesmo
 * evento não duplica. Retorna quantos e-mails foram enfileirados.
 */
export async function notifyScheduleImpact(
  sql: Sql,
  payload: ScheduleImpactPayload,
  opts: { appBaseUrl?: string | undefined; now?: Date; eventId: string },
): Promise<number> {
  const [actor] = await sql<
    { name: string }[]
  >`select name from users where id = ${payload.actorId}`;
  const member = payload.userId
    ? (await sql<{ name: string }[]>`select name from users where id = ${payload.userId}`)[0]
    : undefined;
  const appUrl = opts.appBaseUrl ? new URL('/schedule-admin', opts.appBaseUrl).href : undefined;

  let queued = 0;
  for (const team of payload.teams) {
    const [row] = await sql<{ name: string }[]>`select name from teams where id = ${team.teamId}`;
    const managers = await sql<{ id: string; email: string }[]>`
      select u.id, u.email from users u
      join team_members m on m.user_id = u.id
      where m.team_id = ${team.teamId} and m.role = 'manager' and u.active and not u.is_master
      order by u.id`;
    if (managers.length === 0) continue;
    const rendered = renderScheduleImpactEmail({
      source: payload.source,
      teamName: row?.name ?? 'sua equipe',
      actorName: actor?.name ?? 'Um usuário',
      memberName: member?.name,
      start: payload.start,
      end: payload.end,
      dates: team.dates,
      shifts: team.shifts,
      appUrl,
    });
    for (const m of managers) {
      const r = await enqueueEmail(
        sql,
        {
          to: m.email,
          ...rendered,
          dedupeKey: `schedule-impact:${opts.eventId}:${team.teamId}:${m.id}`,
        },
        opts.now,
      );
      if (!r.duplicate) queued += 1;
    }
  }
  return queued;
}
