import { useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { useRole } from '../team/TeamContext';
import { AdjustmentsList } from '../balance/AdjustmentsList';
import { BalanceView } from '../balance/BalanceView';
import { TeamBalance } from '../balance/TeamBalance';
import type { BalanceTab } from '../balance/paths';
import { todayLocal } from '../schedule/format';
import '../balance/balance.css';
import { PageTitle } from '../team/PageTitle';

const TABS: { id: BalanceTab; label: string }[] = [
  { id: 'mine', label: 'Meu saldo' },
  { id: 'team', label: 'Equipe' },
  { id: 'adjustments', label: 'Ajustes' },
];

export function BalancePage({ currentYear: yearProp }: { currentYear?: number }) {
  const { status } = useAuth();
  const role = useRole();
  const currentYear = yearProp ?? Number(todayLocal().slice(0, 4));
  const [params, setParams] = useSearchParams();
  const requestedYear = Number(params.get('year'));
  const year =
    Number.isInteger(requestedYear) && requestedYear >= 2000 ? requestedYear : currentYear;
  const requestedTab = params.get('tab');
  const tab: BalanceTab = TABS.some((t) => t.id === requestedTab)
    ? (requestedTab as BalanceTab)
    : 'mine';
  const isManager = role === 'manager';
  const years = [
    ...new Set([...Array.from({ length: 5 }, (_, i) => currentYear - 3 + i), year]),
  ].sort();
  const update = (next: { tab?: BalanceTab; year?: number }) => {
    const query = new URLSearchParams(params);
    if (next.tab !== undefined) {
      if (next.tab === 'mine') query.delete('tab');
      else query.set('tab', next.tab);
    }
    if (next.year !== undefined) query.set('year', String(next.year));
    setParams(query, { replace: true });
  };

  if (status === 'loading') {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }

  return (
    <section>
      <PageTitle>Saldo de horas</PageTitle>
      <div className="bal-toolbar">
        <label className="bal-field">
          Ano
          <select value={year} onChange={(e) => update({ year: Number(e.target.value) })}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      {isManager && (
        <div className="bal-tabs" role="tablist" aria-label="Visões do saldo">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`bal-tab-${t.id}`}
              className="bal-tab"
              aria-selected={tab === t.id}
              aria-controls="bal-panel"
              onClick={() => update({ tab: t.id })}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div
        id="bal-panel"
        {...(isManager ? { role: 'tabpanel', 'aria-labelledby': `bal-tab-${tab}` } : {})}
      >
        {(!isManager || tab === 'mine') && (
          <BalanceView key={year} path={`/api/me/balance?year=${year}`} label="Meu saldo" />
        )}
        {isManager && tab === 'team' && <TeamBalance year={year} />}
        {isManager && tab === 'adjustments' && <AdjustmentsList year={year} />}
      </div>
    </section>
  );
}
