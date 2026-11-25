import { recordAudit } from '../audit/index.js';
import { publishEvent } from '../events/publisher.js';
import type { AuthUser, Role } from '../auth/types.js';
import type { Sql } from '../db.js';
import { localIsoDate } from '../email/format.js';
import { getPreferences } from '../preferences/service.js';
import type { PreferencesDto } from '../preferences/types.js';

export interface TeamDto {
  id: string;
  name: string;
  dashboardUrl: string | null;
  avatar: string | null;
}

/** Equipe acessível ao usuário, com o papel dele nela (`user.role` para master e convidado). */
export interface AccessibleTeamDto extends TeamDto {
  role: Role;
  participatesInRotation: boolean;
}

export type MemberRole = 'manager' | 'member';

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
export async function listAccessibleTeams(db: Sql, user: AuthUser): Promise<AccessibleTeamDto[]> {
  if (user.isMaster || user.role === 'guest') {
    const teams = await db<
      TeamDto[]
    >`select id, name, dashboard_url as "dashboardUrl", avatar from teams order by lower(name), id`;
    return teams.map((t) => ({
      ...t,
      role: user.role,
      participatesInRotation: user.participatesInRotation,
    }));
  }
  return db<AccessibleTeamDto[]>`
    select t.id, t.name, t.dashboard_url as "dashboardUrl", t.avatar,
      m.role, m.participates_in_rotation as "participatesInRotation"
    from teams t
    join team_members m on m.team_id = t.id
    where m.user_id = ${user.id}
    order by lower(t.name), t.id`;
}

/**
 * users.role é o papel global: gestor se for gestor em alguma equipe, senão membro. Quem tem
 * ao menos uma equipe deixa de ser convidado (somente leitura).
 */
async function syncGlobalRole(tx: Sql, userId: string): Promise<void> {
  await tx`
    update users set updated_at = now(),
      role = case when exists (
        select 1 from team_members where user_id = ${userId} and role = 'manager')
        then 'manager' else 'member' end
    where id = ${userId} and not is_master
      and (role <> 'guest' or exists (select 1 from team_members where user_id = ${userId}))`;
}

/** Bloqueia remover/rebaixar o último gestor ativo da equipe. */
async function assertNotLastManager(tx: Sql, teamId: string, userId: string): Promise<void> {
  const [other] = await tx`
    select 1 from team_members m join users u on u.id = m.user_id
    where m.team_id = ${teamId} and m.role = 'manager' and u.active and m.user_id <> ${userId}
    limit 1`;
  if (!other) {
    throw new TeamsError(
      409,
      'last_manager',
      'Não é possível remover ou rebaixar o último gestor ativo da equipe',
    );
  }
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
      await tx`
        insert into team_members (team_id, user_id, role, participates_in_rotation)
        values (${team!.id}, ${actor.id}, 'manager', ${actor.participatesInRotation})`;
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

/** Master gerencia qualquer equipe; gestor, só as equipes em que é gestor. */
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
      select 1 from team_members
      where team_id = ${teamId} and user_id = ${actor.id} and role = 'manager'`;
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
  active: boolean;
  role: MemberRole;
  participatesInRotation: boolean;
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
      select u.id, u.name, u.email, u.active, m.role,
        m.participates_in_rotation as "participatesInRotation"
      from users u
      join team_members m on m.user_id = u.id and m.team_id = ${teamId}
      where not u.is_master
      order by lower(u.name), u.id`;
  });
}

export interface TeamMemberProfileDto extends TeamMemberDto {
  phone: string | null;
  badgeNumber: string | null;
  preferences: PreferencesDto;
  /** Exceções individuais (férias, folga, outro) em andamento ou futuras. */
  unavailabilities: {
    id: string;
    kind: string;
    startDate: string;
    endDate: string;
    note: string | null;
  }[];
}

/** Cartão do membro para o gestor da equipe: contatos, preferências e exceções do perfil. */
export async function getTeamMemberProfile(
  db: Sql,
  actor: AuthUser,
  teamId: string,
  userId: string,
): Promise<TeamMemberProfileDto> {
  return db.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    await assertCanManage(tx, actor, teamId);
    const [member] = await tx<Omit<TeamMemberProfileDto, 'preferences' | 'unavailabilities'>[]>`
      select u.id, u.name, u.email, u.phone, u.badge_number as "badgeNumber", u.active, m.role,
        m.participates_in_rotation as "participatesInRotation"
      from users u
      join team_members m on m.user_id = u.id and m.team_id = ${teamId}
      where u.id = ${userId} and not u.is_master`;
    if (!member) throw new TeamsError(404, 'member_not_found', 'Membro não encontrado na equipe');
    const unavailabilities = await tx<TeamMemberProfileDto['unavailabilities']>`
      select id, kind, start_date::text as "startDate", end_date::text as "endDate", note
      from unavailabilities
      where user_id = ${userId} and end_date >= ${localIsoDate(new Date())}::date
      order by start_date, end_date, id`;
    return { ...member, preferences: await getPreferences(tx, userId), unavailabilities };
  });
}

export interface TeamMemberInput {
  role?: MemberRole | undefined;
  participatesInRotation?: boolean | undefined;
}

/**
 * Gestor vincula um usuário (não master) a uma equipe que ele gerencia, ou altera papel/rodízio
 * de quem já está nela. Sem valores, o novo vínculo é membro que participa do rodízio.
 */
export async function setTeamMember(
  db: Sql,
  actor: AuthUser,
  teamId: string,
  userId: string,
  input: TeamMemberInput = {},
): Promise<TeamMemberDto> {
  return db.begin(async (txRaw) =>
    setTeamMemberTx(txRaw as unknown as Sql, actor, teamId, userId, input),
  );
}

/** Versão de {@link setTeamMember} para uso dentro de uma transação já aberta. */
export async function setTeamMemberTx(
  tx: Sql,
  actor: AuthUser,
  teamId: string,
  userId: string,
  input: TeamMemberInput = {},
  opts: { notify?: boolean } = {},
): Promise<TeamMemberDto> {
  const notify = opts.notify ?? true;
  await assertCanManage(tx, actor, teamId);
  const [user] = await tx<{ name: string; email: string; active: boolean }[]>`
      select name, email, active from users where id = ${userId} and not is_master for update`;
  if (!user) throw new TeamsError(404, 'user_not_found', 'Usuário não encontrado');
  const [before] = await tx<{ role: MemberRole; participatesInRotation: boolean }[]>`
      select role, participates_in_rotation as "participatesInRotation"
      from team_members where team_id = ${teamId} and user_id = ${userId} for update`;
  const role = input.role ?? before?.role ?? 'member';
  const participates = input.participatesInRotation ?? before?.participatesInRotation ?? true;
  if (before?.role === 'manager' && role !== 'manager') {
    await assertNotLastManager(tx, teamId, userId);
  }
  if (!before) {
    await tx`
        insert into team_members (team_id, user_id, role, participates_in_rotation)
        values (${teamId}, ${userId}, ${role}, ${participates})`;
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'team.add_member',
      entityType: 'team',
      entityId: teamId,
      after: { userId, email: user.email, role, participatesInRotation: participates },
    });
    if (notify) {
      await publishEvent(tx, 'team.member_added', {
        teamId,
        userId,
        role,
        participatesInRotation: participates,
        actorId: actor.id,
      });
    }
  } else if (before.role !== role || before.participatesInRotation !== participates) {
    await tx`
        update team_members set role = ${role}, participates_in_rotation = ${participates}
        where team_id = ${teamId} and user_id = ${userId}`;
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'team.update_member',
      entityType: 'team',
      entityId: teamId,
      before: {
        userId,
        role: before.role,
        participatesInRotation: before.participatesInRotation,
      },
      after: { userId, role, participatesInRotation: participates },
    });
    if (notify) {
      await publishEvent(tx, 'team.member_updated', {
        teamId,
        userId,
        role,
        participatesInRotation: participates,
        actorId: actor.id,
      });
    }
  }
  await syncGlobalRole(tx, userId);
  return {
    id: userId,
    name: user.name,
    email: user.email,
    active: user.active,
    role,
    participatesInRotation: participates,
  };
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
    const [link] = await tx<{ role: MemberRole; participates: boolean }[]>`
      select role, participates_in_rotation as participates from team_members where team_id = ${teamId} and user_id = ${userId} for update`;
    if (!link) throw new TeamsError(404, 'member_not_found', 'Membro não encontrado na equipe');
    if (link.role === 'manager') await assertNotLastManager(tx, teamId, userId);
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
    await syncGlobalRole(tx, userId);
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'team.remove_member',
      entityType: 'team',
      entityId: teamId,
      before: { userId },
    });
    await publishEvent(tx, 'team.member_removed', {
      teamId,
      userId,
      role: link.role,
      participatesInRotation: link.participates,
      actorId: actor.id,
    });
  });
}
