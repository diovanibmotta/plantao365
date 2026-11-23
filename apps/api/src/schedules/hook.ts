import type { Sql } from '../db.js';

/**
 * Executa um gancho de notificação dentro da transação da mutação, num savepoint: se o gancho
 * falhar, só o savepoint é desfeito (a mutação e a transação continuam válidas) e o erro é engolido.
 */
export async function runHookInSavepoint(tx: Sql, hook: (sql: Sql) => void | Promise<void>) {
  try {
    await (
      tx as unknown as {
        savepoint: (fn: (sp: unknown) => Promise<void>) => Promise<void>;
      }
    ).savepoint(async (sp) => {
      await hook(sp as unknown as Sql);
    });
  } catch {
    // falha de notificação não desfaz a mutação (a factory do gancho registra o erro)
  }
}
