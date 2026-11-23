import { useEffect, useState } from 'react';
import { api } from '../api/client';

export type Loaded<T> =
  { loading: true } | { loading: false; error: string } | { loading: false; data: T };

export function useApiData<T>(path: string, version = 0): Loaded<T> {
  const key = `${path}|${version}`;
  const [state, setState] = useState<{ key: string; result: Loaded<T> } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<T>(path, controller.signal)
      .then((data) => setState({ key, result: { loading: false, data } }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = err instanceof Error ? err.message : 'Não foi possível carregar o saldo.';
        setState({ key, result: { loading: false, error } });
      });
    return () => controller.abort();
  }, [path, key]);

  return state?.key === key ? state.result : { loading: true };
}
