import { recordAudit } from '../audit/index.js';
import type { AuthUser } from '../auth/types.js';
import type { Sql } from '../db.js';

export interface TeamDto {
  id: string;
  name: string;
  dashboardUrl: string | null;
  avatar: string | null;
}

export interface TeamInput {
  name: string;
  dashboardUrl?: string | null;
  avatar?: string | null;
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
    return db<
      TeamDto[]
    >`select id, name, dashboard_url as "dashboardUrl", avatar from teams order by lower(name), id`;
  }
  return db<TeamDto[]>`
    select t.id, t.name, t.dashboard_url as "dashboardUrl", t.avatar from teams t
    join team_members m on m.team_id = t.id
    where m.user_id = ${user.id}
    order by lower(t.name), t.id`;
}

export async function createTeam(db: Sql, actor: AuthUser, input: TeamInput): Promise<TeamDto> {
  const { name } = input;
  return db.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const [dup] = await tx`select 1 from teams where lower(name) = lower(${name})`;
    if (dup) throw new TeamsError(409, 'team_name_in_use', 'Já existe uma equipe com este nome');
    const [team] = await tx<TeamDto[]>`insert into teams (name, dashboard_url, avatar)
      values (${name}, ${input.dashboardUrl ?? null}, ${input.avatar ?? null})
      returning id, name, dashboard_url as "dashboardUrl", avatar`;
    if (!actor.isMaster) {
      await tx`insert into team_members (team_id, user_id) values (${team!.id}, ${actor.id})`;
    }
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'create',
      entityType: 'team',
      entityId: team!.id,
      after: { ...input },
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
): Promise<{ name: string; dashboardUrl: string | null; avatar: string | null }> {
  const [team] = await tx<
    { name: string; dashboardUrl: string | null; avatar: string | null }[]
  >`select name, dashboard_url as "dashboardUrl", avatar from teams where id = ${teamId} for update`;
  if (!team) throw new TeamsError(404, 'team_not_found', 'Equipe não encontrada');
  if (!actor.isMaster) {
    const [member] = await tx`
      select 1 from team_members where team_id = ${teamId} and user_id = ${actor.id}`;
    if (!member) throw new TeamsError(404, 'team_not_found', 'Equipe não encontrada');
  }
  return team;
}

export async function updateTeam(
  db: Sql,
  actor: AuthUser,
  teamId: string,
  input: TeamInput,
): Promise<TeamDto> {
  const { name } = input;
  return db.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const before = await assertCanManage(tx, actor, teamId);
    const [dup] = await tx`
      select 1 from teams where lower(name) = lower(${name}) and id <> ${teamId}`;
    if (dup) throw new TeamsError(409, 'team_name_in_use', 'Já existe uma equipe com este nome');
    const [team] = await tx<
      TeamDto[]
    >`update teams set name = ${name}, dashboard_url = ${input.dashboardUrl ?? null},
      avatar = ${input.avatar ?? null}
      where id = ${teamId} returning id, name, dashboard_url as "dashboardUrl", avatar`;
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'update',
      entityType: 'team',
      entityId: teamId,
      before: { name: before.name },
      after: { ...input },
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

export interface TeamMemberDto {
  id: string;
  name: string;
  email: string;
}

export async function listTeamMembers(
  db: Sql,
  actor: AuthUser,
  teamId: string,
): Promise<TeamMemberDto[]> {
  return db.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    await assertCanManage(tx, actor, teamId);
    return tx<TeamMemberDto[]>`
      select u.id, u.name, u.email from users u
      join team_members m on m.user_id = u.id and m.team_id = ${teamId}
      where not u.is_master
      order by lower(u.name), u.id`;
  });
}

/** Gestor vincula um usuário (não master) a uma equipe que ele gerencia; idempotente. */
export async function linkTeamMember(
  db: Sql,
  actor: AuthUser,
  teamId: string,
  userId: string,
): Promise<void> {
  await db.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    await assertCanManage(tx, actor, teamId);
    const [user] = await tx<
      { email: string }[]
    >`select email from users where id = ${userId} and not is_master`;
    if (!user) throw new TeamsError(404, 'user_not_found', 'Usuário não encontrado');
    const rows = await tx`
      insert into team_members (team_id, user_id) values (${teamId}, ${userId})
      on conflict do nothing returning user_id`;
    if (rows.length === 0) return;
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'team.add_member',
      entityType: 'team',
      entityId: teamId,
      after: { userId, email: user.email },
    });
  });
}

/** Desvincula o usuário da equipe; bloqueia se ele ainda tem plantões nas escalas dela. */
export async function unlinkTeamMember(
  db: Sql,
  actor: AuthUser,
  teamId: string,
  userId: string,
): Promise<void> {
  await db.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    await assertCanManage(tx, actor, teamId);
    const [link] = await tx`
      select 1 from team_members where team_id = ${teamId} and user_id = ${userId} for update`;
    if (!link) throw new TeamsError(404, 'member_not_found', 'Membro não encontrado na equipe');
    const [shift] = await tx`
      select 1 from shifts s join schedules sc on sc.id = s.schedule_id
      where sc.team_id = ${teamId} and s.user_id = ${userId} limit 1`;
    if (shift) {
      throw new TeamsError(
        409,
        'member_has_shifts',
        'O membro possui plantões nas escalas desta equipe e não pode ser desvinculado',
      );
    }
    await tx`delete from team_members where team_id = ${teamId} and user_id = ${userId}`;
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'team.remove_member',
      entityType: 'team',
      entityId: teamId,
      before: { userId },
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
