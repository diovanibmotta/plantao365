import type { Sql } from '../db.js';
import type { Logger } from '../logger.js';
import type { ScheduleImpact, ScheduleImpactNotifier, ScheduleImpactTrigger } from './types.js';

type SavepointSql = Sql & { savepoint: <T>(fn: (sp: Sql) => Promise<T>) => Promise<T> };

/**
 * Roda o notificador num savepoint da transação da mutação: se falhar, só o aviso é perdido (a
 * mutação permanece) e o erro é registrado. Sem notificador, devolve `null`.
 */
export async function runScheduleImpact(
  tx: Sql,
  notifier: ScheduleImpactNotifier | undefined,
  trigger: ScheduleImpactTrigger,
  logger?: Logger,
): Promise<ScheduleImpact | null> {
  if (!notifier) return null;
  try {
    return await (tx as SavepointSql).savepoint((sp) => notifier(sp, trigger));
  } catch (err) {
    logger?.error({ err, source: trigger.source }, 'Falha ao avisar impacto em escala publicada');
    return null;
  }
}
