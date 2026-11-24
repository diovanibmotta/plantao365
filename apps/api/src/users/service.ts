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

const nameSchema = z.string().trim().min(1, 'Nome obrigatório').max(200);

export const createUserSchema = z
  .object({
    name: nameSchema,
    email: z.string().trim().toLowerCase().max(254).pipe(z.email('E-mail inválido')),
  })
  .strict();

export const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
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
  active: r.active,
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

/** Todos os usuários cadastrados (exceto master); o vínculo com equipes é feito na equipe. */
export async function listUsers(db: Sql): Promise<UserListItemDto[]> {
  const rows = await db<UserRow[]>`
    select * from users where not is_master order by lower(name), email`;
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
 * Pré-cadastro: somente nome e e-mail. O usuário não entra em nenhuma equipe (papel e rodízio
 * são definidos ao vinculá-lo a uma equipe) e recebe o e-mail de convite (outbox).
 */
export async function createUser(
  db: Sql,
  actorId: string,
  input: CreateUserInput,
  opts: { appBaseUrl?: string | undefined } = {},
): Promise<UserListItemDto> {
  return db.begin(async (tx) => {
    const [existing] = await tx<UserRow[]>`select id from users where email = ${input.email}`;
    if (existing) {
      throw new UsersError(409, 'email_in_use', 'Já existe um usuário com este e-mail');
    }
    const [row] = await tx<UserRow[]>`
      insert into users (name, email, role, participates_in_rotation)
      values (${input.name}, ${input.email}, 'guest', false)
      returning *`;
    await recordAudit(tx, {
      actorId,
      action: 'create',
      entityType: 'user',
      entityId: row!.id,
      after: snapshot(toProfile(row!)),
    });
    const invite = renderInviteEmail({
      name: row!.name,
      appUrl: opts.appBaseUrl ? new URL('/', opts.appBaseUrl).href : undefined,
    });
    await enqueueEmail(tx, {
      to: row!.email,
      ...invite,
      dedupeKey: `invite:${row!.id}`,
    });
    return toListItem(row!, []);
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
  opts: { finder?: FutureShiftsFinder; now?: () => Date } = {},
): Promise<UserListItemDto> {
  return db.begin(async (tx) => {
    const [before] = await tx<UserRow[]>`select * from users where id = ${userId} for update`;
    if (!before || before.is_master) {
      throw new UsersError(404, 'not_found', 'Usuário não encontrado');
    }
    const active = input.active ?? before.active;
    const deactivating = before.active && !active;
    if (deactivating) {
      // Serializa com outras mudanças de gestão das equipes em que o usuário é gestor.
      await tx`
        select id from teams
        where id in (select team_id from team_members where user_id = ${userId} and role = 'manager')
        order by id for update`;
      const [sole] = await tx`
        select 1 from team_members m
        where m.user_id = ${userId} and m.role = 'manager'
          and not exists (
            select 1 from team_members o join users ou on ou.id = o.user_id
            where o.team_id = m.team_id and o.role = 'manager' and ou.active
              and o.user_id <> ${userId})
        limit 1`;
      if (sole) {
        throw new UsersError(
          409,
          'last_manager',
          'Não é possível desativar o último gestor ativo de uma equipe',
        );
      }
      await assertCanDeactivate(tx, userId, opts.finder, (opts.now ?? (() => new Date()))());
    }

    const [after] = await tx<UserRow[]>`
      update users set
        name = ${input.name ?? before.name},
        active = ${active},
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
