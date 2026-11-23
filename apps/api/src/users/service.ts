import type postgres from 'postgres';
import { z } from 'zod';
import { recordAudit, type AuditJson } from '../audit/index.js';
import type { Role } from '../auth/index.js';
import type { Sql } from '../db.js';
import type {
  CreateUserInput,
  ProfileDto,
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

/**
 * Ponto de extensão: hoje sempre permite. A task 6.7 passará a recusar a desativação
 * de quem tem plantões futuros publicados.
 */
export async function assertCanDeactivate(tx: Tx, userId: string): Promise<void> {
  void tx;
  void userId;
  await Promise.resolve();
}

export async function updateUser(
  db: Sql,
  actorId: string,
  userId: string,
  input: UpdateUserInput,
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
    if (deactivating) await assertCanDeactivate(tx, userId);

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
