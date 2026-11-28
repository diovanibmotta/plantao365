import { useEffect, useState } from 'react';
import { api } from '../api/client';

/** GET ao montar, com a mensagem de erro de carregamento. */
export function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api
      .get<T>(path, controller.signal)
      .then(setData)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Não foi possível carregar os dados.');
      });
    return () => controller.abort();
  }, [path]);
  return { data, error };
}
