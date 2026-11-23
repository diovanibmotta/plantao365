import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api/client';
import { describe, errorCode, VIOLATION_LABEL, formatDate } from './types';
import type { GenerateResult } from './types';

interface GenerateFormProps {
  names: Map<string, string>;
  onGenerated: (result: GenerateResult) => void;
  result: GenerateResult | null;
}

export function GenerateForm({ names, onGenerated, result }: GenerateFormProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOf = (id: string) => names.get(id) ?? 'Membro';

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
    <section aria-labelledby="sad-generate-title" className="sad-block">
      <h2 id="sad-generate-title">Gerar rascunho</h2>
      <form className="sad-row" onSubmit={(e) => void submit(e)}>
        <label>
          De
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Até
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Gerando…' : 'Gerar rascunho'}
        </button>
      </form>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="sad-report" role="status" aria-label="Resultado da geração">
          <p>
            Rascunho gerado para {formatDate(result.schedule.startDate)} a{' '}
            {formatDate(result.schedule.endDate)}.
          </p>
          <p>
            {result.unassignedDates.length === 0
              ? 'Todos os dias têm responsável.'
              : `Dias sem responsável: ${result.unassignedDates.map(formatDate).join(', ')}.`}
          </p>
          {result.preferenceViolations.length > 0 && (
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
          <table className="sad-table">
            <caption>Resumo por membro</caption>
            <thead>
              <tr>
                <th scope="col">Membro</th>
                <th scope="col">Plantões</th>
                <th scope="col">Horas</th>
                <th scope="col">Fins de semana e feriados</th>
              </tr>
            </thead>
            <tbody>
              {result.summary.map((s) => (
                <tr key={s.userId}>
                  <th scope="row">{nameOf(s.userId)}</th>
                  <td>{s.shifts}</td>
                  <td>{s.hours}h</td>
                  <td>{s.weekendHolidayShifts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
