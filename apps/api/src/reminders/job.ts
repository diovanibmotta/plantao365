import type { Sql } from '../db.js';
import type { Logger } from '../logger.js';
import { runReminders, type RunRemindersResult } from './service.js';

export interface ReminderJobOptions {
  sql: Sql;
  logger: Logger;
  intervalMs?: number;
  leadHours?: number;
  appBaseUrl?: string;
  now?: () => Date;
}

export interface ReminderJob {
  /** Executa um ciclo agora (reaproveita o ciclo em andamento, se houver); nunca lança. */
  runOnce(): Promise<RunRemindersResult>;
  /** Para de agendar e aguarda o ciclo em andamento terminar. */
  stop(): Promise<void>;
}

export function startReminderJob(options: ReminderJobOptions): ReminderJob {
  const { sql, logger, intervalMs = 5 * 60_000, ...runOpts } = options;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<RunRemindersResult> | undefined;

  const cycle = (): Promise<RunRemindersResult> => {
    running ??= runReminders(sql, { ...runOpts, logger })
      .catch((err: unknown) => {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'Erro ao processar lembretes de plantão',
        );
        return { enqueued: 0, skipped: 0 };
      })
      .finally(() => {
        running = undefined;
      });
    return running;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      void cycle().finally(schedule);
    }, intervalMs);
    timer.unref();
  };
  void cycle();
  schedule();

  return {
    runOnce: cycle,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
