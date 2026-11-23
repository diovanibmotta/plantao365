import { BalanceDetail } from './BalanceDetail';
import type { MemberBalance } from './types';
import { useApiData } from './useApiData';

export function BalanceView({ path, label }: { path: string; label: string }) {
  const result = useApiData<MemberBalance>(path);
  if (result.loading) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }
  if ('error' in result) {
    return (
      <p className="alert" role="alert">
        {result.error}
      </p>
    );
  }
  return (
    <section aria-label={label}>
      <BalanceDetail balance={result.data} />
    </section>
  );
}
