import { useEffect, useMemo, useState } from 'react';
import type { LocalDate } from '@diovanibmotta/plantao365-shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  WEEK_HEADERS,
  addMonths,
  buildMonthGrid,
  monthKeyOf,
  monthLabel,
  monthRange,
} from '../schedule/calendar';
import type { MonthKey } from '../schedule/calendar';
import {
  DAY_TYPE_LABEL,
  formatDayShort,
  formatHours,
  holidayMap,
  todayLocal,
} from '../schedule/format';
import type { HolidayDto, ShiftDto, UnavailabilityDto } from '../schedule/types';
import '../schedule/schedule.css';

interface MonthData {
  shifts: ShiftDto[];
  holidays: Map<LocalDate, string>;
  vacations: UnavailabilityDto[];
}

type Outcome = { error: string } | { data: MonthData };

interface TeamSchedulePageProps {
  today?: LocalDate;
}

export function TeamSchedulePage({ today: todayProp }: TeamSchedulePageProps) {
  const today = todayProp ?? todayLocal();
  const { user } = useAuth();
  const [month, setMonth] = useState<MonthKey>(() => monthKeyOf(today));
  const [member, setMember] = useState('');
  const [loaded, setLoaded] = useState<{ month: MonthKey; outcome: Outcome } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { from, to } = monthRange(month);
    const range = `from=${from}&to=${to}`;
    Promise.all([
      api.get<ShiftDto[]>(`/api/shifts?${range}`, controller.signal),
      api.get<{ items: HolidayDto[] }>(`/api/holidays?${range}`, controller.signal),
      api.get<{ items: UnavailabilityDto[] }>(`/api/unavailabilities?${range}`, controller.signal),
    ])
      .then(([shifts, holidays, vacations]) =>
        setLoaded({
          month,
          outcome: {
            data: {
              shifts,
              holidays: holidayMap(holidays.items),
              vacations: vacations.items.filter((v) => v.kind === 'collective_vacation'),
            },
          },
        }),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = err instanceof Error ? err.message : 'Não foi possível carregar a escala.';
        setLoaded({ month, outcome: { error } });
      });
    return () => controller.abort();
  }, [month]);

  const outcome = loaded?.month === month ? loaded.outcome : null;
  const data = outcome && 'data' in outcome ? outcome.data : null;

  const members = useMemo(() => {
    const byId = new Map<string, string>();
    for (const s of data?.shifts ?? []) {
      if (s.userId && s.userName) byId.set(s.userId, s.userName);
    }
    return [...byId].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [data]);

  const activeMember = members.some(([id]) => id === member) ? member : '';

  return (
    <section>
      <h1>Escala</h1>
      <div className="sched-toolbar">
        <div className="sched-nav">
          <button
            type="button"
            className="btn"
            aria-label="Mês anterior"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            ‹
          </button>
          <button type="button" className="btn" onClick={() => setMonth(monthKeyOf(today))}>
            Hoje
          </button>
          <button
            type="button"
            className="btn"
            aria-label="Próximo mês"
            onClick={() => setMonth(addMonths(month, 1))}
          >
            ›
          </button>
        </div>
        <h2 className="sched-month" aria-live="polite">
          {monthLabel(month)}
        </h2>
        <label className="sched-filter">
          Membro
          <select value={activeMember} onChange={(e) => setMember(e.target.value)}>
            <option value="">Todos</option>
            {members.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {outcome === null && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {outcome !== null && 'error' in outcome && (
        <p className="alert" role="alert">
          {outcome.error}
        </p>
      )}
      {data && (
        <MonthCalendar
          month={month}
          data={data}
          today={today}
          userId={user?.id ?? null}
          member={activeMember}
        />
      )}
    </section>
  );
}

interface MonthCalendarProps {
  month: MonthKey;
  data: MonthData;
  today: LocalDate;
  userId: string | null;
  member: string;
}

function MonthCalendar({ month, data, today, userId, member }: MonthCalendarProps) {
  const shiftsByDate = new Map<LocalDate, ShiftDto[]>();
  for (const s of data.shifts) {
    if (member && s.userId !== member) continue;
    shiftsByDate.set(s.date, [...(shiftsByDate.get(s.date) ?? []), s]);
  }
  const dayTypeByDate = new Map<LocalDate, ShiftDto['dayType']>();
  for (const s of data.shifts) dayTypeByDate.set(s.date, s.dayType);
  const isVacation = (date: LocalDate) =>
    data.vacations.some((v) => date >= v.startDate && date <= v.endDate) ||
    data.shifts.some((s) => s.date === date && s.dayType === 'collective_vacation');

  return (
    <>
      <ul className="sched-weekdays" aria-hidden="true">
        {WEEK_HEADERS.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <ol className="sched-grid" aria-label={`Escala de ${monthLabel(month)}`}>
        {buildMonthGrid(month).map((date, i) => {
          if (!date) return <li key={`pad-${i}`} className="sched-day sched-day--outside" />;
          const shifts = (shiftsByDate.get(date) ?? []).filter(
            (s) => s.dayType !== 'collective_vacation',
          );
          const holiday = data.holidays.get(date);
          const vacation = isVacation(date);
          const dayType = dayTypeByDate.get(date);
          const typeLabel =
            !holiday && (dayType === 'weekday' || dayType === 'weekend')
              ? DAY_TYPE_LABEL[dayType]
              : null;
          const mine = shifts.some((s) => userId !== null && s.userId === userId);
          const classes = ['sched-day'];
          if (mine) classes.push('sched-day--mine');
          if (date === today) classes.push('sched-day--today');
          if (shifts.length === 0 && !holiday && !vacation) classes.push('sched-day--empty');
          return (
            <li key={date} className={classes.join(' ')} data-testid={`day-${date}`}>
              <time dateTime={date} className="sched-day-number" aria-label={formatDayShort(date)}>
                {Number(date.slice(8, 10))}
              </time>
              {typeLabel && (
                <span className="sched-day-type" data-testid={`day-type-${date}`}>
                  {typeLabel}
                </span>
              )}
              {holiday && <span className="sched-day-note">Feriado: {holiday}</span>}
              {vacation && <span className="sched-day-note">Férias coletivas</span>}
              {shifts.map((s) => (
                <span key={s.id}>
                  <span className="sched-day-name">
                    {s.userName ?? 'Sem responsável'}
                    {mine && s.userId === userId ? ' (você)' : ''}
                  </span>{' '}
                  <span className="muted">{formatHours(s.hours)}</span>
                </span>
              ))}
            </li>
          );
        })}
      </ol>
      <ul className="sched-legend" aria-label="Legenda">
        <li>
          <span className="sched-swatch sched-swatch--mine" aria-hidden="true" />
          Seu plantão
        </li>
        <li>Dia útil: 14h</li>
        <li>Fim de semana: 24h</li>
        <li>Feriado e férias coletivas aparecem em destaque</li>
        <li>Horas ao lado do nome</li>
      </ul>
    </>
  );
}
