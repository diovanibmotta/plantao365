import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api/client';
import { Diff } from './Diff';
import { formatDate, parseHours } from './format';
import type { Adjustment, TeamBalanceData } from './types';
import { useApiData } from './useApiData';

export function Adjustments({ year }: { year: number }) {
  const [filter, setFilter] = useState('');
  const [version, setVersion] = useState(0);
  const team = useApiData<TeamBalanceData>(`/api/balance?year=${year}`);
  const query = `year=${year}${filter ? `&userId=${filter}` : ''}`;
  const list = useApiData<{ items: Adjustment[] }>(`/api/balance/adjustments?${query}`, version);
  const [actionError, setActionError] = useState<string | null>(null);

  const members = 'data' in team ? team.data.members : [];
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.name ?? id;

  const remove = async (item: Adjustment) => {
    const label = `${nameOf(item.userId)} em ${formatDate(item.date)}`;
    if (!window.confirm(`Remover o ajuste de ${label}?`)) return;
    setActionError(null);
    try {
      await api.delete(`/api/balance/adjustments/${item.id}`);
      setVersion((v) => v + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível remover o ajuste.');
    }
  };

  return (
    <>
      <AdjustmentForm year={year} members={members} onCreated={() => setVersion((v) => v + 1)} />

      <h3 className="bal-h">Ajustes lançados</h3>
      <div className="bal-toolbar">
        <label className="bal-field">
          Filtrar por membro
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Todos</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {actionError && (
        <p className="alert" role="alert">
          {actionError}
        </p>
      )}
      {list.loading && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {!list.loading && 'error' in list && (
        <p className="alert" role="alert">
          {list.error}
        </p>
      )}
      {!list.loading && 'data' in list && list.data.items.length === 0 && (
        <p className="status muted">Nenhum ajuste neste ano.</p>
      )}
      {!list.loading && 'data' in list && list.data.items.length > 0 && (
        <div className="table-wrap">
          <table className="audit-table bal-table">
            <caption className="sr-only">Ajustes de saldo em {year}</caption>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Membro</th>
                <th scope="col" className="bal-r">
                  Horas
                </th>
                <th scope="col">Motivo</th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((a) => (
                <tr key={a.id} data-testid="bal-adjustment">
                  <td>{formatDate(a.date)}</td>
                  <td>{nameOf(a.userId)}</td>
                  <td className="bal-r">
                    <Diff value={a.hours} />
                  </td>
                  <td>{a.reason}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Remover ajuste de ${nameOf(a.userId)} em ${formatDate(a.date)}`}
                      onClick={() => void remove(a)}
                    >
                      Remover
                    </button>
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

interface FormProps {
  year: number;
  members: { userId: string; name: string }[];
  onCreated: () => void;
}

function AdjustmentForm({ year, members, onCreated }: FormProps) {
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState('');
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = parseHours(hours);
    if (!userId) return setError('Selecione o membro.');
    if (!date) return setError('Informe a data.');
    if (amount === null || amount === 0 || Math.abs(amount) > 48) {
      return setError('Informe as horas, positivas ou negativas, diferentes de zero (até 48).');
    }
    if (!reason.trim()) return setError('Informe o motivo.');
    setError(null);
    setBusy(true);
    try {
      await api.post('/api/balance/adjustments', {
        userId,
        date,
        hours: amount,
        reason: reason.trim(),
      });
      setHours('');
      setReason('');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o ajuste.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="bal-form" onSubmit={(e) => void submit(e)} noValidate>
      <h3 className="bal-h">Novo ajuste</h3>
      <div className="bal-form-grid">
        <label className="bal-field">
          Membro
          <select value={userId} onChange={(e) => setUserId(e.target.value)} required>
            <option value="">Selecione…</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="bal-field">
          Data
          <input
            type="date"
            value={date}
            min={`${year}-01-01`}
            max={`${year}-12-31`}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <label className="bal-field">
          Horas (+/-)
          <input
            type="text"
            inputMode="decimal"
            placeholder="ex.: -2,5"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            required
          />
        </label>
        <label className="bal-field bal-wide">
          Motivo
          <input
            type="text"
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
        </label>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy}>
        Adicionar ajuste
      </button>
    </form>
  );
}
