import type { Sql } from '../db.js';
import type { SqlOrTx } from '../audit/index.js';
import type { UnavailabilityDto, UnavailabilityKind, UnavailableByDate } from './types.js';

const columns = (sql: Sql) => sql`
  id, user_id as "userId", team_id as "teamId", kind, start_date::text as "startDate", end_date::text as "endDate",
  note, created_by as "createdBy", created_at::text as "createdAt", updated_at::text as "updatedAt"`;

export interface ListFilters {
  from?: string | undefined;
  to?: string | undefined;
  userId?: string | undefined;
  visibleTo?: string | undefined;
  /** Férias coletivas desta equipe (ou legadas, sem equipe) e exceções de qualquer usuário. */
  teamId?: string | undefined;
  /** Quem consulta: as próprias exceções aparecem mesmo sem ser membro da equipe (ex.: master). */
  selfId?: string | undefined;
}

export async function listUnavailabilities(
  db: Sql,
  { from, to, userId, visibleTo, teamId, selfId }: ListFilters,
): Promise<UnavailabilityDto[]> {
  return db<UnavailabilityDto[]>`
    select ${columns(db)} from unavailabilities
    where true
      ${visibleTo ? db`and (user_id = ${visibleTo} or user_id is null)` : db``}
      ${
        teamId
          ? db`and ((user_id is null and (team_id is null or team_id = ${teamId}))
            or user_id in (select user_id from team_members where team_id = ${teamId})
            ${selfId ? db`or user_id = ${selfId}` : db``})`
          : db``
      }
      ${userId ? db`and user_id = ${userId}` : db``}
      ${from ? db`and end_date >= ${from}::date` : db``}
      ${to ? db`and start_date <= ${to}::date` : db``}
    order by start_date, end_date, id`;
}

export async function getUnavailability(
  db: SqlOrTx,
  id: string,
  forUpdate = false,
): Promise<UnavailabilityDto | null> {
  const sql = db as Sql;
  const [row] = await sql<UnavailabilityDto[]>`
    select ${columns(sql)} from unavailabilities where id = ${id}
    ${forUpdate ? sql`for update` : sql``}`;
  return row ?? null;
}

export async function insertUnavailability(
  db: SqlOrTx,
  v: {
    userId: string | null;
    kind: UnavailabilityKind;
    startDate: string;
    endDate: string;
    note: string | null;
    createdBy: string;
    teamId?: string | null;
  },
): Promise<UnavailabilityDto> {
  const sql = db as Sql;
  const [row] = await sql<UnavailabilityDto[]>`
    insert into unavailabilities (user_id, kind, start_date, end_date, note, created_by, team_id)
    values (${v.userId}, ${v.kind}, ${v.startDate}::date, ${v.endDate}::date, ${v.note},
      ${v.createdBy}, ${v.userId === null ? (v.teamId ?? null) : null})
    returning ${columns(sql)}`;
  return row!;
}

export async function updateUnavailability(
  db: SqlOrTx,
  id: string,
  v: { kind: UnavailabilityKind; startDate: string; endDate: string; note: string | null },
): Promise<UnavailabilityDto> {
  const sql = db as Sql;
  const [row] = await sql<UnavailabilityDto[]>`
    update unavailabilities
    set kind = ${v.kind}, start_date = ${v.startDate}::date, end_date = ${v.endDate}::date,
      note = ${v.note}, updated_at = now()
    where id = ${id}
    returning ${columns(sql)}`;
  return row!;
}

export async function deleteUnavailability(db: SqlOrTx, id: string): Promise<void> {
  const sql = db as Sql;
  await sql`delete from unavailabilities where id = ${id}`;
}

/** Bloqueios do período para a geração de escala (sem HTTP). Datas AAAA-MM-DD. */
export async function listUnavailableByDate(
  sql: Sql,
  from: string,
  to: string,
  teamId?: string,
): Promise<UnavailableByDate> {
  const collective = await sql<{ start: string; end: string }[]>`
    select greatest(start_date, ${from}::date)::text as start,
      least(end_date, ${to}::date)::text as "end"
    from unavailabilities
    where user_id is null and end_date >= ${from}::date and start_date <= ${to}::date
      ${teamId ? sql`and (team_id is null or team_id = ${teamId})` : sql``}
    order by start_date, end_date`;
  const days = await sql<{ userId: string; day: string }[]>`
    select distinct u.user_id as "userId", d::date::text as day
    from unavailabilities u
    cross join lateral generate_series(
      greatest(u.start_date, ${from}::date), least(u.end_date, ${to}::date), interval '1 day'
    ) as d
    where u.user_id is not null and u.end_date >= ${from}::date and u.start_date <= ${to}::date
    order by 1, 2`;
  const byUser = new Map<string, string[]>();
  for (const { userId, day } of days) {
    const list = byUser.get(userId);
    if (list) list.push(day);
    else byUser.set(userId, [day]);
  }
  return { collectiveVacations: collective, byUser };
}
