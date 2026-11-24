import { createHash, timingSafeEqual } from 'node:crypto';
import { recordAudit } from '../audit/index.js';
import type { Sql } from '../db.js';
import type { MasterKeyOptions } from './types.js';

/** E-mail interno da linha do usuário master; nunca é usado para login SSO. */
export const MASTER_EMAIL = 'master@plantao365.invalid';

const digest = (v: string) => createHash('sha256').update(v).digest();

/** Compara usuário e senha em tempo constante (ambos sempre avaliados). */
export function verifyMasterCredentials(
  master: MasterKeyOptions,
  username: string,
  password: string,
): boolean {
  const userOk = timingSafeEqual(digest(master.username), digest(username));
  const passOk = timingSafeEqual(digest(master.password), digest(password));
  return userOk && passOk;
}

/**
 * Sincroniza a linha do usuário master com a configuração: com master definida, cria/ativa
 * (gestor, fora do rodízio) e atualiza o nome; sem master, desativa e derruba as sessões.
 * Idempotente. Retorna o id do usuário master ou null quando desabilitado/inexistente.
 */
export async function syncMasterUser(
  db: Sql,
  master: MasterKeyOptions | undefined,
): Promise<string | null> {
  return db.begin(async (tx) => {
    const [existing] = await tx<{ id: string; name: string; active: boolean }[]>`
      select id, name, active from users where is_master for update`;
    if (!master) {
      if (existing?.active) {
        await tx`update users set active = false, updated_at = now() where id = ${existing.id}`;
        await tx`delete from sessions where user_id = ${existing.id}`;
        await recordAudit(tx, {
          actorId: null,
          action: 'update',
          entityType: 'user',
          entityId: existing.id,
          before: { active: true },
          after: { active: false },
          reason: 'master key removida da configuração',
        });
      }
      return existing?.id ?? null;
    }
    if (!existing) {
      const [row] = await tx<{ id: string }[]>`
        insert into users (email, name, role, active, participates_in_rotation,
          reminders_enabled, is_master)
        values (${MASTER_EMAIL}, ${master.username}, 'manager', true, false, false, true)
        returning id`;
      await recordAudit(tx, {
        actorId: null,
        action: 'create',
        entityType: 'user',
        entityId: row!.id,
        after: { role: 'manager', master: true },
        reason: 'master key configurada',
      });
      return row!.id;
    }
    if (!existing.active || existing.name !== master.username) {
      await tx`update users set active = true, name = ${master.username}, updated_at = now()
        where id = ${existing.id}`;
    }
    return existing.id;
  });
}

export interface LoginLimiterOptions {
  maxFailures?: number;
  windowMs?: number;
  now?: () => number;
}

/**
 * Limitador global em memória das tentativas de login master: após `maxFailures` falhas na
 * janela, bloqueia novas tentativas até a janela esvaziar. Global (não por IP) porque o IP
 * atrás de proxy não é confiável; o SSO não é afetado.
 */
export function createLoginLimiter({
  maxFailures = 5,
  windowMs = 15 * 60_000,
  now = Date.now,
}: LoginLimiterOptions = {}) {
  let failures: number[] = [];
  const prune = () => {
    const limit = now() - windowMs;
    failures = failures.filter((t) => t > limit);
  };
  return {
    blocked(): boolean {
      prune();
      return failures.length >= maxFailures;
    },
    fail(): void {
      prune();
      failures.push(now());
    },
    reset(): void {
      failures = [];
    },
  };
}
