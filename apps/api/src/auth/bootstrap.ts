import type { Sql } from '../db.js';
import { recordAudit } from '../audit/index.js';

interface ExistingRow {
  id: string;
  role: string;
  active: boolean;
}

/**
 * Garante que os e-mails informados existam como gestores ativos: cria o usuário ausente,
 * promove quem é membro e reativa quem está inativo, mantendo os demais campos. Cada mudança
 * é auditada (ator nulo = sistema); quem já era gestor ativo não é tocado, então reinícios
 * são idempotentes. Retorna os e-mails criados ou ajustados.
 */
export async function bootstrapManagers(db: Sql, emails: readonly string[]): Promise<string[]> {
  const changed: string[] = [];
  for (const email of new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))) {
    const didChange = await db.begin(async (tx) => {
      const [existing] = await tx<ExistingRow[]>`
        select id, role, active from users where email = ${email} for update`;
      if (!existing) {
        const [row] = await tx<{ id: string }[]>`
          insert into users (email, name, role, active, participates_in_rotation)
          values (${email}, ${email.split('@')[0] ?? email}, 'manager', true, false)
          returning id`;
        await recordAudit(tx, {
          actorId: null,
          action: 'create',
          entityType: 'user',
          entityId: row!.id,
          after: { email, role: 'manager', active: true },
          reason: 'bootstrap MANAGER_EMAILS',
        });
        return true;
      }
      if (existing.role === 'manager' && existing.active) return false;
      await tx`update users set role = 'manager', active = true, updated_at = now()
        where id = ${existing.id}`;
      await tx`update team_members set role = 'manager' where user_id = ${existing.id}`;
      await recordAudit(tx, {
        actorId: null,
        action: 'update',
        entityType: 'user',
        entityId: existing.id,
        before: { role: existing.role, active: existing.active },
        after: { role: 'manager', active: true },
        reason: 'bootstrap MANAGER_EMAILS',
      });
      return true;
    });
    // Gestor sem equipe não acessa nada: entra na equipe mais antiga (a padrão da migração).
    await db`
      insert into team_members (team_id, user_id, role, participates_in_rotation)
      select (select id from teams order by created_at, id limit 1), u.id, 'manager', false
      from users u
      where u.email = ${email}
        and not exists (select 1 from team_members m where m.user_id = u.id)
      on conflict do nothing`;
    if (didChange) changed.push(email);
  }
  return changed;
}
