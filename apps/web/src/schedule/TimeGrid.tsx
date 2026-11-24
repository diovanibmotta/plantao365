import { useEffect, useRef } from 'react';
import {
  DEFAULT_SHIFT_TIMES,
  addDays,
  dayOfWeek,
  formatMinute,
  isWeekend,
} from '@diovanibmotta/plantao365-shared';
import type { LocalDate, ShiftTimes, WorkPeriod } from '@diovanibmotta/plantao365-shared';
import { Avatar } from '../layout/Avatar';
import { WEEK_HEADERS, segmentOnDate } from './calendar';
import type { DaySegment } from './calendar';
import { formatHours, formatPeriod, localDateMinute } from './format';
import type { ShiftDto } from './types';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const pct = (minute: number) => `${(minute / 1440) * 100}%`;

interface Bounds {
  start: { date: LocalDate; minute: number };
  end: { date: LocalDate; minute: number };
}

/** Início e fim do plantão em data local + minuto; sem instantes, usa o horário configurado. */
function shiftBounds(shift: ShiftDto, shiftTimes: ShiftTimes | null): Bounds | null {
  if (shift.startsAt && shift.endsAt) {
    return { start: localDateMinute(shift.startsAt), end: localDateMinute(shift.endsAt) };
  }
  if (shift.dayType === 'collective_vacation') return null;
  const t = (shiftTimes ?? DEFAULT_SHIFT_TIMES)[shift.dayType];
  return {
    start: { date: shift.date, minute: t.startHour * 60 },
    end: {
      date: t.endHour > t.startHour ? shift.date : addDays(shift.date, 1),
      minute: t.endHour * 60,
    },
  };
}

export interface TimeGridProps {
  dates: LocalDate[];
  shifts: ShiftDto[];
  holidays: Map<LocalDate, string>;
  vacationDates: ReadonlySet<LocalDate>;
  today: LocalDate;
  userId: string | null;
  member: string;
  shiftTimes: ShiftTimes | null;
  workPeriods: readonly WorkPeriod[];
}

/** Grade de horas (00h–24h) por dia: plantões por pessoa e jornada de trabalho do time. */
export function TimeGrid({
  dates,
  shifts,
  holidays,
  vacationDates,
  today,
  userId,
  member,
  shiftTimes,
  workPeriods,
}: TimeGridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const firstWork = workPeriods[0]?.startMinute ?? 7 * 60;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = (Math.max(firstWork - 60, 0) / 1440) * el.scrollHeight;
  }, [firstWork, dates]);

  const bounds = shifts
    .filter((s) => !member || s.userId === member)
    .map((shift) => ({ shift, b: shiftBounds(shift, shiftTimes) }))
    .filter((x): x is { shift: ShiftDto; b: Bounds } => x.b !== null);

  const columns = dates.map((date) => {
    const segments: Array<{ shift: ShiftDto; seg: DaySegment; b: Bounds }> = [];
    for (const { shift, b } of bounds) {
      const seg = segmentOnDate(date, b.start, b.end);
      if (seg) segments.push({ shift, seg, b });
    }
    const workday =
      !isWeekend(date) && !holidays.has(date) && !vacationDates.has(date) && workPeriods.length > 0;
    return { date, segments, workday };
  });

  return (
    <>
      <div className="tg" style={{ ['--tg-cols' as string]: dates.length }}>
        <div className="tg-head" aria-hidden="true">
          <div className="tg-gutter" />
          {dates.map((date) => (
            <div key={date} className={`tg-head-day${date === today ? ' tg-head-day--today' : ''}`}>
              <span>{WEEK_HEADERS[dayOfWeek(date)]}</span>
              <strong>{Number(date.slice(8, 10))}</strong>
              {holidays.has(date) && <small>{holidays.get(date)}</small>}
              {vacationDates.has(date) && <small>Férias coletivas</small>}
            </div>
          ))}
        </div>
        <div className="tg-scroll" ref={scroller} data-testid="time-grid">
          <div className="tg-body">
            <div className="tg-gutter">
              {HOURS.map((h) => (
                <span key={h} className="tg-hour" style={{ top: pct(h * 60) }}>
                  {h === 0 ? '' : `${String(h).padStart(2, '0')}h`}
                </span>
              ))}
            </div>
            {columns.map(({ date, segments, workday }) => (
              <div
                key={date}
                className={`tg-col${date === today ? ' tg-col--today' : ''}`}
                data-testid={`col-${date}`}
              >
                {workday &&
                  workPeriods.map((p) => (
                    <div
                      key={p.startMinute}
                      className="tg-work"
                      data-testid={`work-${date}`}
                      style={{ top: pct(p.startMinute), height: pct(p.endMinute - p.startMinute) }}
                    />
                  ))}
                {segments.map(({ shift, seg, b }) => {
                  const mine = userId !== null && shift.userId === userId;
                  const name = shift.userName ?? 'Sem responsável';
                  const continues = seg.startMinute === 0 && b.start.date !== date;
                  const goesOn = seg.endMinute === 1440 && b.end.date !== date;
                  const minutes = seg.endMinute - seg.startMinute;
                  return (
                    <div
                      key={`${shift.id}-${date}`}
                      className={`tg-shift${mine ? ' tg-shift--mine' : ''}`}
                      data-testid={`seg-${shift.id}-${date}`}
                      style={{ top: pct(seg.startMinute), height: pct(minutes) }}
                      title={`${name} · ${formatPeriod(shift)} · ${formatHours(shift.hours)}`}
                    >
                      <span className="tg-shift-who">
                        {shift.userId && <Avatar userId={shift.userId} name={name} />}
                        <span className="tg-shift-name">
                          {name}
                          {mine ? ' (você)' : ''}
                        </span>
                      </span>
                      <span className="tg-shift-time">
                        {formatMinute(seg.startMinute)}–{formatMinute(seg.endMinute)}
                      </span>
                      <span className="tg-shift-meta muted">
                        Plantão {formatPeriod(shift)} · {formatHours(shift.hours)}
                        {continues && ' · continuação do dia anterior'}
                        {goesOn && ' · continua no dia seguinte'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <ul className="sched-legend" aria-label="Legenda">
        <li>
          <span className="sched-swatch sched-swatch--mine" aria-hidden="true" />
          Seu plantão
        </li>
        <li>
          <span className="sched-swatch sched-swatch--work" aria-hidden="true" />
          Jornada do time:{' '}
          {workPeriods.length === 0
            ? 'não definida'
            : workPeriods
                .map((p) => `${formatMinute(p.startMinute)}–${formatMinute(p.endMinute)}`)
                .join(' | ')}
        </li>
      </ul>
    </>
  );
}
