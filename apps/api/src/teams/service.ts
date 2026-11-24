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

const DEFAULT_TEAM_ID = '00000000-0000-0000-0000-000000000001';

/** Master gerencia qualquer equipe; gestor, só as que integra. */
async function assertCanManage(
  tx: Sql,
  actor: AuthUser,
  teamId: string,
): Promise<{ name: string }> {
  const [team] = await tx<
    { name: string }[]
  >`select name from teams where id = ${teamId} for update`;
  if (!team) throw new TeamsError(404, 'team_not_found', 'Equipe não encontrada');
  if (!actor.isMaster) {
    const [member] = await tx`
      select 1 from team_members where team_id = ${teamId} and user_id = ${actor.id}`;
    if (!member) throw new TeamsError(404, 'team_not_found', 'Equipe não encontrada');
  }
  return team;
}

export async function renameTeam(
  db: Sql,
  actor: AuthUser,
  teamId: string,
  name: string,
): Promise<TeamDto> {
  return db.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const before = await assertCanManage(tx, actor, teamId);
    const [dup] = await tx`
      select 1 from teams where lower(name) = lower(${name}) and id <> ${teamId}`;
    if (dup) throw new TeamsError(409, 'team_name_in_use', 'Já existe uma equipe com este nome');
    const [team] = await tx<
      TeamDto[]
    >`update teams set name = ${name} where id = ${teamId} returning id, name`;
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'update',
      entityType: 'team',
      entityId: teamId,
      before: { name: before.name },
      after: { name },
    });
    return team!;
  });
}

export async function deleteTeam(db: Sql, actor: AuthUser, teamId: string): Promise<void> {
  await db.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const before = await assertCanManage(tx, actor, teamId);
    if (teamId === DEFAULT_TEAM_ID) {
      throw new TeamsError(409, 'team_protected', 'A equipe principal não pode ser excluída');
    }
    const [used] = await tx`select 1 from schedules where team_id = ${teamId} limit 1`;
    if (used) {
      throw new TeamsError(
        409,
        'team_has_schedules',
        'A equipe possui escalas e não pode ser excluída',
      );
    }
    await tx`delete from teams where id = ${teamId}`;
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'delete',
      entityType: 'team',
      entityId: teamId,
      before: { name: before.name },
    });
  });
}

/** Vincula o usuário à equipe (idempotente); retorna true quando o vínculo foi criado. */
export async function addTeamMember(db: Sql, teamId: string, userId: string): Promise<boolean> {
  const rows = await db`
    insert into team_members (team_id, user_id) values (${teamId}, ${userId})
    on conflict do nothing returning user_id`;
  return rows.length > 0;
}
