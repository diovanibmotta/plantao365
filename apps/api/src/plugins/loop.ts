export interface Loop {
  runOnce(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Executa `fn` a cada `intervalMs` (sem sobreposição; `runOnce` reaproveita a execução em curso).
 * Erros vão para `onError`; o loop continua. Mesmo padrão dos workers do core.
 */
export function startLoop(
  fn: () => Promise<unknown>,
  intervalMs: number,
  onError: (err: unknown) => void,
): Loop {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;

  const cycle = (): Promise<void> => {
    running ??= fn()
      .then(() => undefined)
      .catch(onError)
      .finally(() => {
        running = undefined;
      });
    return running;
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => void cycle().finally(schedule), intervalMs);
    timer.unref();
  };
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
