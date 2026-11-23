import { DAY_TYPE_LABEL, formatDayShort } from '../schedule/format';
import { Diff } from './Diff';
import { formatHours, formatMonth } from './format';
import type { MemberBalance } from './types';

export function BalanceDetail({ balance }: { balance: MemberBalance }) {
  return (
    <>
      <h3 className="bal-h">Saldo mensal</h3>
      <div className="table-wrap">
        <table className="audit-table bal-table">
          <caption className="sr-only">Saldo mensal de horas em {balance.year}</caption>
          <thead>
            <tr>
              <th scope="col">Mês</th>
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
            {balance.months.map((m) => (
              <tr key={m.month}>
                <th scope="row">{formatMonth(m.month)}</th>
                <td className="bal-r">{formatHours(m.planned)}</td>
                <td className="bal-r">{formatHours(m.actual)}</td>
                <td className="bal-r">
                  <Diff value={m.difference} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total do ano</th>
              <td className="bal-r">{formatHours(balance.total.planned)}</td>
              <td className="bal-r">{formatHours(balance.total.actual)}</td>
              <td className="bal-r">
                <Diff value={balance.total.difference} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h3 className="bal-h">Plantões</h3>
      {balance.shifts.length === 0 ? (
        <p className="status muted">Nenhum plantão neste ano.</p>
      ) : (
        <div className="table-wrap">
          <table className="audit-table bal-table">
            <caption className="sr-only">Detalhamento por plantão em {balance.year}</caption>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Tipo de dia</th>
                <th scope="col" className="bal-r">
                  Previsto
                </th>
                <th scope="col" className="bal-r">
                  Realizado
                </th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {balance.shifts.map((s) => (
                <tr key={s.date} data-testid="bal-shift">
                  <td>{formatDayShort(s.date)}</td>
                  <td>{DAY_TYPE_LABEL[s.dayType]}</td>
                  <td className="bal-r">{formatHours(s.plannedHours)}</td>
                  <td className="bal-r">{formatHours(s.actualHours)}</td>
                  <td>
                    {s.status === 'upcoming' ? 'Futuro' : 'Concluído'}
                    {s.swapped && <span className="bal-tag">Troca</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
