import type postgres from 'postgres';
import { addDays, TIME_ZONE } from '@diovanibmotta/plantao365-shared';
import { z } from 'zod';
import { recordAudit, type AuditJson } from '../audit/index.js';
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

const roleSchema = z.enum(['manager', 'member']);
const nameSchema = z.string().trim().min(1, 'Nome obrigatório').max(200);

export const createUserSchema = z
  .object({
    name: nameSchema,
    email: z.string().trim().toLowerCase().max(254).pipe(z.email('E-mail inválido')),
    role: roleSchema.optional(),
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

const toListItem = (r: UserRow): UserListItemDto => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  active: r.active,
  participatesInRotation: r.participates_in_rotation,
  createdAt: r.created_at.toISOString(),
  linked: r.oid !== null,
});

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

export async function listUsers(db: Sql): Promise<UserListItemDto[]> {
  const rows = await db<UserRow[]>`select * from users order by lower(name), email`;
  return rows.map(toListItem);
}

export async function createUser(
  db: Sql,
  actorId: string,
  input: CreateUserInput,
): Promise<UserListItemDto> {
  const role = input.role ?? 'member';
  const participates = input.participatesInRotation ?? role === 'member';
  return db.begin(async (tx) => {
    const [row] = await tx<UserRow[]>`
      insert into users (name, email, role, participates_in_rotation)
      values (${input.name}, ${input.email}, ${role}, ${participates})
      on conflict (email) do nothing
      returning *`;
    if (!row) throw new UsersError(409, 'email_in_use', 'Já existe um usuário com este e-mail');
    await recordAudit(tx, {
      actorId,
      action: 'create',
      entityType: 'user',
      entityId: row.id,
      after: snapshot(toProfile(row)),
    });
    return toListItem(row);
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
    const managers = await tx<{ id: string }[]>`
      select id from users where role = 'manager' and active order by id for update`;
    const [before] = await tx<UserRow[]>`select * from users where id = ${userId} for update`;
    if (!before) throw new UsersError(404, 'not_found', 'Usuário não encontrado');

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

    const participates = input.participatesInRotation ?? before.participates_in_rotation;
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
    return toListItem(after!);
  });
}
