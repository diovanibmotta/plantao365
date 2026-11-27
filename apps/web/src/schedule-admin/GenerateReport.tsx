import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api/client';
import { describe, errorCode, VIOLATION_LABEL, formatDate } from './types';
import type { GenerateResult, ScheduleDetail } from './types';
import { summarizeShifts } from './schedule-summary';

interface GenerateFormProps {
  onGenerated: (result: GenerateResult) => void;
  onCancel: () => void;
}

export function GenerateForm({ onGenerated, onCancel }: GenerateFormProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!from || !to) {
      setError('Informe o início e o fim do período.');
      return;
    }
    setBusy(true);
    try {
      onGenerated(await api.post<GenerateResult>('/api/schedules/generate', { from, to }));
    } catch (err) {
      setError(
        errorCode(err) === 'schedule_overlap'
          ? 'O período se sobrepõe a um rascunho existente. Descarte-o ou escolha outro período.'
          : describe(err, 'Não foi possível gerar o rascunho.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)}>
      <div className="sad-row">
        <label>
          De
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Até
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="sad-row">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Gerando…' : 'Gerar rascunho'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

interface ScheduleSummaryProps {
  names: Map<string, string>;
  schedule: ScheduleDetail;
  /** Presente só logo após a geração: preferências violadas não ficam gravadas na base. */
  result?: GenerateResult;
}

/** Cobertura e totais por membro, calculados dos plantões gravados; vale para rascunho e publicada. */
export function GenerateReport({ names, schedule, result }: ScheduleSummaryProps) {
  const nameOf = (id: string) => names.get(id) ?? 'Membro';
  const totals = useMemo(() => summarizeShifts(schedule.shifts, names), [schedule.shifts, names]);
  const unassigned = totals.unassignedDates.length;
  const violations = result?.preferenceViolations.length ?? 0;
  const maxHours = totals.members.reduce((max, m) => Math.max(max, m.hours), 0);
  const totalHours = totals.members.reduce((sum, m) => sum + m.hours, 0);
  const percentOf = (hours: number) =>
    totalHours > 0 ? `${((hours / totalHours) * 100).toFixed(1).replace('.', ',')}%` : '0%';
  const tone = unassigned > 0 ? 'bad' : violations > 0 ? 'warn' : 'ok';
  return (
    <div
      className="sad-report"
      role={result ? 'status' : undefined}
      aria-label={result ? 'Resultado da geração' : undefined}
    >
      {result && (
        <p>
          Rascunho gerado para {formatDate(schedule.startDate)} a {formatDate(schedule.endDate)}.
        </p>
      )}
      <p className={`sad-banner sad-banner--${tone}`}>
        {unassigned === 0
          ? 'Todos os dias têm responsável.'
          : `Dias sem responsável: ${totals.unassignedDates.map(formatDate).join(', ')}.`}
      </p>
      <dl className="sad-kpis">
        <div className={`sad-kpi${unassigned > 0 ? ' sad-kpi--bad' : ''}`}>
          <dt>Dias cobertos</dt>
          <dd>{`${Math.max(totals.totalDays - unassigned, 0)}/${totals.totalDays}`}</dd>
        </div>
        {result && (
          <div className={`sad-kpi${violations > 0 ? ' sad-kpi--warn' : ''}`}>
            <dt>Preferências não atendidas</dt>
            <dd>{violations}</dd>
          </div>
        )}
        <div className="sad-kpi">
          <dt>Diferença entre maior e menor carga</dt>
          <dd>{totals.spread}h</dd>
        </div>
        <div className="sad-kpi">
          <dt>Carga média por membro</dt>
          <dd>{totals.average}h</dd>
        </div>
      </dl>
      {result && result.preferenceViolations.length > 0 && (
        <>
          <p>Preferências não atendidas:</p>
          <ul>
            {result.preferenceViolations.map((v) => (
              <li key={`${v.date}-${v.userId}-${v.kind}`}>
                {formatDate(v.date)}: {nameOf(v.userId)} ({VIOLATION_LABEL[v.kind]})
              </li>
            ))}
          </ul>
        </>
      )}
      <details className="sad-summary" open>
        <summary>
          <span className="sad-summary-title">Resumo por membro</span>
          <span className="sad-summary-count">{totals.members.length} membros</span>
        </summary>
        <div className="sad-table-wrap">
          <table className="sad-summary-table" aria-label="Resumo por membro">
            <thead>
              <tr>
                <th scope="col">Membro</th>
                <th scope="col" className="sad-num">
                  Plantões
                </th>
                <th scope="col">Horas</th>
                <th scope="col" className="sad-num">
                  Fins de semana e feriados
                </th>
              </tr>
            </thead>
            <tbody>
              {totals.members.map((s) => (
                <tr key={s.userId}>
                  <th scope="row">{s.name}</th>
                  <td className="sad-num">{s.shifts}</td>
                  <td>
                    <div className="sad-load">
                      <span className="sad-load-bar" aria-hidden="true">
                        <span
                          className="sad-load-fill"
                          style={{ width: `${maxHours > 0 ? (s.hours / maxHours) * 100 : 0}%` }}
                        />
                      </span>
                      <span className="sad-load-value">{s.hours}h</span>
                      <span className="sad-load-percent">{percentOf(s.hours)}</span>
                    </div>
                  </td>
                  <td className="sad-num">{s.weekendHolidayShifts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
