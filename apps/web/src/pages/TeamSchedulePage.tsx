import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_WORK_PERIODS,
  SHIFT_DAY_TYPES,
  addDays,
  isWeekend,
  shiftDuration,
} from '@diovanibmotta/plantao365-shared';
import type { LocalDate, ShiftTimes, WorkPeriod } from '@diovanibmotta/plantao365-shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useRole } from '../team/TeamContext';
import { Avatar } from '../layout/Avatar';
import {
  WEEK_HEADERS,
  buildMonthGrid,
  monthKeyOf,
  monthLabel,
  shiftAnchor,
  viewDates,
  viewLabel,
  viewRange,
} from '../schedule/calendar';
import type { CalendarView, MonthKey } from '../schedule/calendar';
import { TimeGrid } from '../schedule/TimeGrid';
import {
  DAY_TYPE_LABEL,
  SHIFT_STATUS_LABEL,
  formatDayShort,
  formatHours,
  formatPeriod,
  formatShiftTime,
  holidayMap,
  shiftStatus,
  todayLocal,
} from '../schedule/format';
import type { ShiftStatusFilter } from '../schedule/format';
import type { HolidayDto, ShiftDto, UnavailabilityDto } from '../schedule/types';
import '../schedule/schedule.css';
import { PageTitle } from '../team/PageTitle';

/** Opção do filtro de membro que representa o usuário logado (como o @me do Azure DevOps). */
const ME = '@me';

interface Colleague {
  id: string;
  name: string;
}

interface MonthData {
  shifts: ShiftDto[];
  holidays: Map<LocalDate, string>;
  vacations: UnavailabilityDto[];
}

type Outcome = { error: string } | { data: MonthData };

const VIEWS: Array<[CalendarView, string]> = [
  ['month', 'Mês'],
  ['week', 'Semana'],
  ['day', 'Dia'],
];
const PREVIOUS: Record<CalendarView, string> = {
  month: 'Mês anterior',
  week: 'Semana anterior',
  day: 'Dia anterior',
};
const NEXT: Record<CalendarView, string> = {
  month: 'Próximo mês',
  week: 'Próxima semana',
  day: 'Próximo dia',
};

/** Datas de férias coletivas conhecidas nos dados carregados. */
function vacationDates(data: MonthData): Set<LocalDate> {
  const out = new Set<LocalDate>();
  for (const s of data.shifts) if (s.dayType === 'collective_vacation') out.add(s.date);
  for (const v of data.vacations) {
    for (let d = v.startDate; d <= v.endDate; d = addDays(d, 1)) out.add(d);
  }
  return out;
}

interface TeamSchedulePageProps {
  today?: LocalDate;
}

export function TeamSchedulePage({ today: todayProp }: TeamSchedulePageProps) {
  const today = todayProp ?? todayLocal();
  const { user } = useAuth();
  const isGuest = useRole() === 'guest';
  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState<LocalDate>(today);
  const [member, setMember] = useState('');
  const [status, setStatus] = useState<ShiftStatusFilter>('');
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [loaded, setLoaded] = useState<{ key: string; outcome: Outcome } | null>(null);
  const [shiftTimes, setShiftTimes] = useState<ShiftTimes | null>(null);
  const [workPeriods, setWorkPeriods] = useState<WorkPeriod[]>([...DEFAULT_WORK_PERIODS]);
  const month = monthKeyOf(anchor);
  const { from, to } = viewRange(view, anchor);
  const key = `${view}:${from}:${to}`;

  useEffect(() => {
    const controller = new AbortController();
    // Só alimenta a legenda; falha não impede o calendário.
    api
      .get<ShiftTimes>('/api/shift-settings', controller.signal)
      .then(setShiftTimes)
      .catch(() => undefined);
    // Jornada de trabalho do time: destaque nas visões de dia e semana; falha mantém o padrão.
    api
      .get<{ periods: WorkPeriod[] }>('/api/work-hours', controller.signal)
      .then((r) => setWorkPeriods(r.periods))
      .catch(() => undefined);
    // Membros da equipe para o filtro; sem eles, o filtro usa só quem aparece na escala.
    api
      .get<Colleague[]>('/api/users/colleagues', controller.signal)
      .then((list) => setColleagues(Array.isArray(list) ? list : []))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const range = `from=${from}&to=${to}`;
    // Convidado não acessa exceções; vê só plantões e feriados.
    const noVacations = { items: [] as UnavailabilityDto[] };
    Promise.all([
      api.get<ShiftDto[]>(`/api/shifts?${range}`, controller.signal),
      api.get<{ items: HolidayDto[] }>(`/api/holidays?${range}`, controller.signal),
      isGuest
        ? Promise.resolve(noVacations)
        : api.get<{ items: UnavailabilityDto[] }>(
            `/api/unavailabilities?${range}`,
            controller.signal,
          ),
    ])
      .then(([shifts, holidays, vacations]) =>
        setLoaded({
          key,
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
        setLoaded({ key, outcome: { error } });
      });
    return () => controller.abort();
  }, [key, from, to, isGuest]);

  const outcome = loaded?.key === key ? loaded.outcome : null;
  const data = outcome && 'data' in outcome ? outcome.data : null;

  const members = useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of colleagues) byId.set(c.id, c.name);
    for (const s of data?.shifts ?? []) {
      if (s.userId && s.userName) byId.set(s.userId, s.userName);
    }
    // O usuário logado aparece como "@me", não pelo nome.
    if (user) byId.delete(user.id);
    return [...byId].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [data, colleagues, user]);

  const canFilterMe = user !== null && !isGuest;
  const selectedMember =
    (member === ME && canFilterMe) || members.some(([id]) => id === member) ? member : '';
  const activeMember = selectedMember === ME && user ? user.id : selectedMember;

  return (
    <section>
      <PageTitle>Calendário</PageTitle>
      <div className="sched-toolbar">
        <div className="sched-nav">
          <button
            type="button"
            className="btn"
            aria-label={PREVIOUS[view]}
            onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}
          >
            ‹
          </button>
          <button type="button" className="btn" onClick={() => setAnchor(today)}>
            Hoje
          </button>
          <button
            type="button"
            className="btn"
            aria-label={NEXT[view]}
            onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}
          >
            ›
          </button>
        </div>
        <h2 className="sched-month" aria-live="polite">
          {viewLabel(view, anchor)}
        </h2>
        <div className="sched-views" role="group" aria-label="Visão do calendário">
          {VIEWS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`btn${view === v ? ' primary' : ''}`}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="sched-filter sched-filter--member">
          Membro
          <select value={selectedMember} onChange={(e) => setMember(e.target.value)}>
            <option value="">Todos</option>
            {canFilterMe && <option value={ME}>{ME}</option>}
            {members.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="sched-filter">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as ShiftStatusFilter)}>
            <option value="">Todos</option>
            <option value="done">{SHIFT_STATUS_LABEL.done}</option>
            <option value="pending">{SHIFT_STATUS_LABEL.pending}</option>
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
      {data && view === 'month' && (
        <MonthCalendar
          month={month}
          data={data}
          today={today}
          userId={user?.id ?? null}
          member={activeMember}
          status={status}
          shiftTimes={shiftTimes}
        />
      )}
      {data && view !== 'month' && (
        <TimeGrid
          dates={viewDates(view, anchor)}
          shifts={data.shifts}
          holidays={data.holidays}
          vacationDates={vacationDates(data)}
          today={today}
          userId={user?.id ?? null}
          member={activeMember}
          status={status}
          shiftTimes={shiftTimes}
          workPeriods={workPeriods}
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
  status: ShiftStatusFilter;
  shiftTimes: ShiftTimes | null;
}

function MonthCalendar({
  month,
  data,
  today,
  userId,
  member,
  status,
  shiftTimes,
}: MonthCalendarProps) {
  const shiftsByDate = new Map<LocalDate, ShiftDto[]>();
  for (const s of data.shifts) {
    if (member && s.userId !== member) continue;
    if (status && shiftStatus(s, today) !== status) continue;
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
          if (holiday) classes.push('sched-day--holiday');
          else if (isWeekend(date)) classes.push('sched-day--weekend');
          if (mine) classes.push('sched-day--mine');
          if (date === today) classes.push('sched-day--today');
          // Com filtro de membro ou status, só os dias dele ficam em destaque; os demais esmaecem sem detalhes.
          const dimmed = (member !== '' || status !== '') && shifts.length === 0;
          if (dimmed) classes.push('sched-day--dimmed');
          else if (shifts.length === 0 && !holiday && !vacation) classes.push('sched-day--empty');
          return (
            <li key={date} className={classes.join(' ')} data-testid={`day-${date}`}>
              <time dateTime={date} className="sched-day-number" aria-label={formatDayShort(date)}>
                {Number(date.slice(8, 10))}
              </time>
              {typeLabel && !dimmed && (
                <span className="sched-day-type" data-testid={`day-type-${date}`}>
                  {typeLabel}
                </span>
              )}
              {holiday && !dimmed && <span className="sched-day-note">Feriado: {holiday}</span>}
              {vacation && !dimmed && <span className="sched-day-note">Férias coletivas</span>}
              {shifts.map((s) => (
                <span key={s.id} className="sched-day-shift">
                  {s.userId && <Avatar userId={s.userId} name={s.userName ?? ''} />}
                  <span>
                    <span className="sched-day-name">
                      {s.userName ?? 'Sem responsável'}
                      {mine && s.userId === userId ? ' (você)' : ''}
                    </span>
                    <span className="sched-day-period">
                      <span>{formatPeriod(s)}</span>
                      {s.endsAt && todayLocal(new Date(s.endsAt)) !== s.date && (
                        <abbr title="Termina no dia seguinte"> +1</abbr>
                      )}{' '}
                      <span className="muted">{formatHours(s.hours)}</span>
                    </span>
                    <span className={`sched-status sched-status--${shiftStatus(s, today)}`}>
                      {SHIFT_STATUS_LABEL[shiftStatus(s, today)]}
                    </span>
                  </span>
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
        {shiftTimes &&
          SHIFT_DAY_TYPES.map((t) => (
            <li key={t}>
              {DAY_TYPE_LABEL[t]}: {formatShiftTime(shiftTimes[t])} (
              {formatHours(shiftDuration(shiftTimes[t]))})
            </li>
          ))}
        <li>Feriado e férias coletivas aparecem em destaque</li>
        <li>Horas ao lado do nome; +1 = termina no dia seguinte</li>
      </ul>
    </>
  );
}
