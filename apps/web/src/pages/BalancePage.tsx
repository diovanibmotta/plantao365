import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useRole } from '../team/TeamContext';
import { Adjustments } from '../balance/Adjustments';
import { BalanceView } from '../balance/BalanceView';
import { TeamBalance } from '../balance/TeamBalance';
import { todayLocal } from '../schedule/format';
import '../balance/balance.css';
import { PageTitle } from '../team/PageTitle';

type Tab = 'mine' | 'team' | 'adjustments';

const TABS: { id: Tab; label: string }[] = [
  { id: 'mine', label: 'Meu saldo' },
  { id: 'team', label: 'Equipe' },
  { id: 'adjustments', label: 'Ajustes' },
];

export function BalancePage({ currentYear: yearProp }: { currentYear?: number }) {
  const { status } = useAuth();
  const role = useRole();
  const currentYear = yearProp ?? Number(todayLocal().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [tab, setTab] = useState<Tab>('mine');
  const isManager = role === 'manager';
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 3 + i);

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
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
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
              onClick={() => setTab(t.id)}
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
        {isManager && tab === 'adjustments' && <Adjustments year={year} />}
      </div>
    </section>
  );
}
