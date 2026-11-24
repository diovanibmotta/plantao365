import type postgres from 'postgres';
import { addDays, TIME_ZONE } from '@diovanibmotta/plantao365-shared';
import { z } from 'zod';
import { recordAudit, type AuditJson } from '../audit/index.js';
import { enqueueEmail, renderInviteEmail } from '../email/index.js';
import type { Role } from '../auth/index.js';
import type { Sql } from '../db.js';
import type {
  CreateUserInput,
  ProfileDto,
  FutureShiftDto,
  FutureShiftsFinder,
  UpdateProfileInput,
  UpdateUserInput,
  UserListItemDto,
} from './types.js';

type Tx = postgres.TransactionSql;

export class UsersError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const PHONE_PATTERN = /^\+?[\d\s()-]+$/;

const phoneSchema = z
  .string()
  .trim()
  .max(30, 'Telefone muito longo')
  .refine((v) => {
    const digits = v.replace(/\D/g, '').length;
    return PHONE_PATTERN.test(v) && digits >= 8 && digits <= 15;
  }, 'Telefone inválido');

export const PROTECTED_PROFILE_FIELDS = [
  'name',
  'email',
  'role',
  'active',
  'participatesInRotation',
] as const;

export const updateProfileSchema = z
  .object({
    phone: phoneSchema.nullable().optional(),
    remindersEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.phone !== undefined || v.remindersEnabled !== undefined, {
    message: 'Informe ao menos um campo para alterar',
  });

const roleSchema = z.enum(['manager', 'member', 'guest']);
const nameSchema = z.string().trim().min(1, 'Nome obrigatório').max(200);

export const createUserSchema = z
  .object({
    name: nameSchema,
    email: z.string().trim().toLowerCase().max(254).pipe(z.email('E-mail inválido')),
    role: z.enum(['manager', 'member']).optional(),
    participatesInRotation: z.boolean().optional(),
  })
  .strict();

export const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
    role: roleSchema.optional(),
    participatesInRotation: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Informe ao menos um campo para alterar',
  });

interface UserRow {
  id: string;
  oid: string | null;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  active: boolean;
  participates_in_rotation: boolean;
  reminders_enabled: boolean;
  is_master: boolean;
  created_at: Date;
}

const toProfile = (r: UserRow): ProfileDto => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  role: r.role,
  active: r.active,
  participatesInRotation: r.participates_in_rotation,
  remindersEnabled: r.reminders_enabled,
});

const toListItem = (r: UserRow, teamIds: string[]): UserListItemDto => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  active: r.active,
  participatesInRotation: r.participates_in_rotation,
  createdAt: r.created_at.toISOString(),
  linked: r.oid !== null,
  teamIds,
});

async function teamIdsOf(db: Sql | Tx, userId: string): Promise<string[]> {
  const rows = await (db as Sql)<{ team_id: string }[]>`
    select team_id from team_members where user_id = ${userId} order by team_id`;
  return rows.map((r) => r.team_id);
}

const snapshot = (p: ProfileDto): AuditJson => ({ ...p });

export async function getProfile(db: Sql, userId: string): Promise<ProfileDto> {
  const [row] = await db<UserRow[]>`select * from users where id = ${userId}`;
  if (!row) throw new UsersError(404, 'not_found', 'Usuário não encontrado');
  return toProfile(row);
}

export async function updateProfile(
  db: Sql,
  userId: string,
  input: UpdateProfileInput,
): Promise<ProfileDto> {
  return db.begin(async (tx) => {
    const [before] = await tx<UserRow[]>`select * from users where id = ${userId} for update`;
    if (!before) throw new UsersError(404, 'not_found', 'Usuário não encontrado');
    const phone = input.phone === undefined ? before.phone : input.phone;
    const reminders = input.remindersEnabled ?? before.reminders_enabled;
    const [after] = await tx<UserRow[]>`
      update users set phone = ${phone}, reminders_enabled = ${reminders}, updated_at = now()
      where id = ${userId} returning *`;
    await recordAudit(tx, {
      actorId: userId,
      action: 'update',
      entityType: 'user',
      entityId: userId,
      before: snapshot(toProfile(before)),
      after: snapshot(toProfile(after!)),
    });
    return toProfile(after!);
  });
}

/** Membros da equipe e convidados (sem equipe, ainda não admitidos), para o gestor admitir. */
export async function listUsers(db: Sql, teamId: string): Promise<UserListItemDto[]> {
  const rows = await db<UserRow[]>`
    select * from users
    where not is_master
      and (role = 'guest'
        or id in (select user_id from team_members where team_id = ${teamId}))
    order by lower(name), email`;
  const links = await db<{ user_id: string; team_id: string }[]>`
    select user_id, team_id from team_members
    where user_id = any(${rows.map((r) => r.id)}::uuid[]) order by team_id`;
  return rows.map((r) =>
    toListItem(
      r,
      links.filter((l) => l.user_id === r.id).map((l) => l.team_id),
    ),
  );
}

/**
 * Cadastrar o usuário é o convite: ele passa a entrar com o papel atribuído e recebe um e-mail
 * (outbox). Se o e-mail já entrou como convidado, o convite o promove em vez de conflitar.
 */
export async function createUser(
  db: Sql,
  actorId: string,
  input: CreateUserInput,
  opts: { appBaseUrl?: string | undefined; teamId: string },
): Promise<UserListItemDto> {
  const role = input.role ?? 'member';
  const participates = input.participatesInRotation ?? role === 'member';
  return db.begin(async (tx) => {
    const [existing] = await tx<UserRow[]>`
      select * from users where email = ${input.email} for update`;
    let row: UserRow | undefined;
    if (!existing) {
      [row] = await tx<UserRow[]>`
        insert into users (name, email, role, participates_in_rotation)
        values (${input.name}, ${input.email}, ${role}, ${participates})
        returning *`;
      await recordAudit(tx, {
        actorId,
        action: 'create',
        entityType: 'user',
        entityId: row!.id,
        after: snapshot(toProfile(row!)),
      });
    } else if (existing.role === 'guest' && !existing.is_master) {
      [row] = await tx<UserRow[]>`
        update users set name = ${input.name}, role = ${role}, active = true,
          participates_in_rotation = ${participates}, reminders_enabled = true, updated_at = now()
        where id = ${existing.id} returning *`;
      await recordAudit(tx, {
        actorId,
        action: 'update',
        entityType: 'user',
        entityId: existing.id,
        before: snapshot(toProfile(existing)),
        after: snapshot(toProfile(row!)),
        reason: 'convite de convidado',
      });
    } else {
      const [member] = await tx`
        select 1 from team_members where team_id = ${opts.teamId} and user_id = ${existing.id}`;
      if (member) {
        throw new UsersError(409, 'email_in_use', 'Este usuário já faz parte da equipe');
      }
      // Usuário de outra equipe: só é vinculado a esta (papel e dados globais não mudam).
      await tx`insert into team_members (team_id, user_id) values (${opts.teamId}, ${existing.id})`;
      await recordAudit(tx, {
        actorId,
        action: 'team.add_member',
        entityType: 'team',
        entityId: opts.teamId,
        after: { userId: existing.id, email: existing.email },
      });
      return toListItem(existing, await teamIdsOf(tx, existing.id));
    }
    await tx`
      insert into team_members (team_id, user_id) values (${opts.teamId}, ${row!.id})
      on conflict do nothing`;
    const invite = renderInviteEmail({
      name: row!.name,
      role: role,
      appUrl: opts.appBaseUrl ? new URL('/', opts.appBaseUrl).href : undefined,
    });
    await enqueueEmail(tx, {
      to: row!.email,
      ...invite,
      dedupeKey: `invite:${row!.id}:${role}`,
    });
    return toListItem(row!, await teamIdsOf(tx, row!.id));
  });
}

const FUTURE_HORIZON_DAYS = 3650;

/** Data local (fuso do sistema) de um instante, no formato AAAA-MM-DD. */
const localToday = (now: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

/** Plantões publicados de hoje em diante atribuídos ao usuário (Req 3.2). */
export async function listFutureShifts(
  db: Sql | Tx,
  finder: FutureShiftsFinder | undefined,
  userId: string,
  now: Date,
): Promise<FutureShiftDto[]> {
  if (!finder) return [];
  const start = localToday(now);
  const found = await finder(db as Sql, {
    userId,
    start,
    end: addDays(start, FUTURE_HORIZON_DAYS),
  });
  const dates = found.map((f) => f.date);
  if (dates.length === 0) return [];
  const rows = await db<
    { id: string; date: string; schedule_id: string; start_date: string; end_date: string }[]
  >`
    select s.id, s.date::text as date, sc.id as schedule_id,
      sc.start_date::text as start_date, sc.end_date::text as end_date
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.status = 'published' and s.user_id = ${userId} and s.date = any(${dates}::date[])
    order by s.date, sc.start_date`;
  return rows.map((r) => ({
    shiftId: r.id,
    date: r.date,
    scheduleId: r.schedule_id,
    scheduleStart: r.start_date,
    scheduleEnd: r.end_date,
  }));
}

/** Bloqueia a desativação enquanto houver plantões futuros publicados (Req 3.2). */
export async function assertCanDeactivate(
  tx: Tx,
  userId: string,
  finder?: FutureShiftsFinder,
  now: Date = new Date(),
): Promise<void> {
  const shifts = await listFutureShifts(tx, finder, userId, now);
  if (shifts.length > 0) {
    throw new UsersError(
      409,
      'has_future_published_shifts',
      'O membro possui plantões futuros publicados; reatribua-os antes de desativar',
      { shifts },
    );
  }
}

export async function updateUser(
  db: Sql,
  actorId: string,
  userId: string,
  input: UpdateUserInput,
  opts: { finder?: FutureShiftsFinder; now?: () => Date; teamId: string },
): Promise<UserListItemDto> {
  return db.begin(async (tx) => {
    const managers = await tx<{ id: string }[]>`
      select id from users where role = 'manager' and active and not is_master order by id for update`;
    const [before] = await tx<UserRow[]>`select * from users where id = ${userId} for update`;
    if (!before || before.is_master) {
      throw new UsersError(404, 'not_found', 'Usuário não encontrado');
    }
    const [inTeam] = await tx`
      select 1 from team_members where team_id = ${opts.teamId} and user_id = ${userId}`;
    if (!inTeam && before.role !== 'guest') {
      throw new UsersError(404, 'not_found', 'Usuário não encontrado');
    }

    const role = input.role ?? before.role;
    const active = input.active ?? before.active;
    const wasActiveManager = before.role === 'manager' && before.active;
    const staysActiveManager = role === 'manager' && active;
    if (wasActiveManager && !staysActiveManager && managers.length <= 1) {
      throw new UsersError(
        409,
        'last_manager',
        'Não é possível remover ou desativar o último gestor ativo',
      );
    }
    const deactivating = before.active && !active;
    if (deactivating)
      await assertCanDeactivate(tx, userId, opts.finder, (opts.now ?? (() => new Date()))());

    const participates =
      role === 'guest' ? false : (input.participatesInRotation ?? before.participates_in_rotation);
    const [after] = await tx<UserRow[]>`
      update users set
        name = ${input.name ?? before.name},
        role = ${role},
        active = ${active},
        participates_in_rotation = ${participates},
        updated_at = now()
      where id = ${userId} returning *`;
    if (deactivating) await tx`delete from sessions where user_id = ${userId}`;
    await recordAudit(tx, {
      actorId,
      action: 'update',
      entityType: 'user',
      entityId: userId,
      before: snapshot(toProfile(before)),
      after: snapshot(toProfile(after!)),
    });
    return toListItem(after!, await teamIdsOf(tx, after!.id));
  });
}
