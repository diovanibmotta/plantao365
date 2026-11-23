import type { Sql } from '../db.js';

/**
 * Garante que os e-mails informados existam como gestores ativos. Usuários já existentes
 * não são alterados nem rebaixados. Retorna os e-mails criados.
 */
export async function bootstrapManagers(db: Sql, emails: readonly string[]): Promise<string[]> {
  const created: string[] = [];
  for (const email of new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))) {
    const rows = await db<{ email: string }[]>`
      insert into users (email, name, role, active, participates_in_rotation)
      values (${email}, ${email.split('@')[0] ?? email}, 'manager', true, false)
      on conflict (email) do nothing
      returning email`;
    created.push(...rows.map((r) => r.email));
  }
  return created;
}
