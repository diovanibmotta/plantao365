import { useState } from 'react';
import { BalanceView } from './BalanceView';
import { Diff } from './Diff';
import { formatHours } from './format';
import type { TeamBalanceData } from './types';
import { useApiData } from './useApiData';

export function TeamBalance({ year }: { year: number }) {
  const result = useApiData<TeamBalanceData>(`/api/balance?year=${year}`);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

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
  const { members } = result.data;
  if (members.length === 0) return <p className="status muted">Nenhum membro no rodízio.</p>;

  return (
    <>
      <div className="table-wrap">
        <table className="audit-table bal-table">
          <caption className="sr-only">Comparativo de saldo da equipe em {year}</caption>
          <thead>
            <tr>
              <th scope="col">Membro</th>
              <th scope="col" className="bal-r">
                Previsto
              </th>
              <th scope="col" className="bal-r">
                Realizado
              </th>
              <th scope="col" className="bal-r">
                Diferença
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <th scope="row">
                  <button
                    type="button"
                    className="bal-link"
                    aria-pressed={selected?.id === m.userId}
                    onClick={() =>
                      setSelected(selected?.id === m.userId ? null : { id: m.userId, name: m.name })
                    }
                  >
                    {m.name}
                  </button>
                </th>
                <td className="bal-r">{formatHours(m.planned)}</td>
                <td className="bal-r">{formatHours(m.actual)}</td>
                <td className="bal-r">
                  <Diff value={m.difference} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="bal-member">
          <h2 className="bal-h">{selected.name}</h2>
          <BalanceView
            key={`${selected.id}-${year}`}
            path={`/api/users/${selected.id}/balance?year=${year}`}
            label={`Saldo de ${selected.name}`}
          />
        </div>
      )}
    </>
  );
}
