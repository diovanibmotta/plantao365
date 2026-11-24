import { recordAudit } from '../audit/index.js';
import type { AuthUser } from '../auth/types.js';
import type { Sql } from '../db.js';

export interface TeamDto {
  id: string;
  name: string;
}

export class TeamsError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Master e convidado (somente leitura) enxergam todas as equipes; os demais, só as suas. */
export async function listAccessibleTeams(db: Sql, user: AuthUser): Promise<TeamDto[]> {
  if (user.isMaster || user.role === 'guest') {
    return db<TeamDto[]>`select id, name from teams order by lower(name), id`;
  }
  return db<TeamDto[]>`
    select t.id, t.name from teams t
    join team_members m on m.team_id = t.id
    where m.user_id = ${user.id}
    order by lower(t.name), t.id`;
}

export async function createTeam(db: Sql, actor: AuthUser, name: string): Promise<TeamDto> {
  return db.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const [dup] = await tx`select 1 from teams where lower(name) = lower(${name})`;
    if (dup) throw new TeamsError(409, 'team_name_in_use', 'Já existe uma equipe com este nome');
    const [team] = await tx<
      TeamDto[]
    >`insert into teams (name) values (${name}) returning id, name`;
    if (!actor.isMaster) {
      await tx`insert into team_members (team_id, user_id) values (${team!.id}, ${actor.id})`;
    }
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'create',
      entityType: 'team',
      entityId: team!.id,
      after: { name },
    });
    return team!;
  });
}

/** Vincula o usuário à equipe (idempotente); retorna true quando o vínculo foi criado. */
export async function addTeamMember(db: Sql, teamId: string, userId: string): Promise<boolean> {
  const rows = await db`
    insert into team_members (team_id, user_id) values (${teamId}, ${userId})
    on conflict do nothing returning user_id`;
  return rows.length > 0;
}
