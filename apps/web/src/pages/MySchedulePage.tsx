import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { addDays } from '@plantao360/shared';
import type { LocalDate } from '@plantao360/shared';
import { api } from '../api/client';
import { formatHours, holidayMap, sumHours, todayLocal } from '../schedule/format';
import { ShiftItem } from '../schedule/ShiftItem';
import type { HolidayDto, ShiftDto } from '../schedule/types';
import { SwapRequestAction } from '../swaps/SwapRequestAction';
import '../schedule/schedule.css';

const PAST_DAYS = 120;
const FUTURE_DAYS = 240;
const SUMMARY_DAYS = 30;

type Tab = 'upcoming' | 'past';

interface MyData {
  shifts: ShiftDto[];
  holidays: Map<LocalDate, string>;
}

type Outcome = { error: string } | { data: MyData };

interface MySchedulePageProps {
  today?: LocalDate;
  renderActions?: (shift: ShiftDto) => ReactNode;
}

export function MySchedulePage({ today: todayProp, renderActions }: MySchedulePageProps) {
  const today = todayProp ?? todayLocal();
  const from = addDays(today, -PAST_DAYS);
  const to = addDays(today, FUTURE_DAYS);
  const key = `${from}|${to}`;
  const [tab, setTab] = useState<Tab>('upcoming');
  const [loaded, setLoaded] = useState<{ key: string; outcome: Outcome } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const range = `from=${from}&to=${to}`;
    Promise.all([
      api.get<ShiftDto[]>(`/api/shifts/mine?${range}`, controller.signal),
      api
        .get<{ items: HolidayDto[] }>(`/api/holidays?${range}`, controller.signal)
        .catch((err: unknown) => {
          if (controller.signal.aborted) throw err;
          return { items: [] as HolidayDto[] };
        }),
    ])
      .then(([shifts, holidays]) =>
        setLoaded({ key, outcome: { data: { shifts, holidays: holidayMap(holidays.items) } } }),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = err instanceof Error ? err.message : 'Não foi possível carregar sua escala.';
        setLoaded({ key, outcome: { error } });
      });
    return () => controller.abort();
  }, [from, to, key]);

  const outcome = loaded?.key === key ? loaded.outcome : null;

  return (
    <section>
      <h1>Minha escala</h1>
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
      {outcome !== null && 'data' in outcome && (
        <MyScheduleView
          data={outcome.data}
          today={today}
          tab={tab}
          onTab={setTab}
          renderActions={renderActions}
        />
      )}
    </section>
  );
}

interface ViewProps {
  data: MyData;
  today: LocalDate;
  tab: Tab;
  onTab: (tab: Tab) => void;
  renderActions: MySchedulePageProps['renderActions'];
}

function MyScheduleView({ data, today, tab, onTab, renderActions }: ViewProps) {
  const upcoming = data.shifts
    .filter((s) => s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const past = data.shifts
    .filter((s) => s.date < today)
    .sort((a, b) => b.date.localeCompare(a.date));
  const list = tab === 'upcoming' ? upcoming : past;
  const total = sumHours(data.shifts, today, SUMMARY_DAYS);

  return (
    <>
      <p className="sched-summary">
        Total nos próximos {SUMMARY_DAYS} dias: <strong>{formatHours(total)}</strong>
      </p>
      <div className="sched-tabs" role="tablist" aria-label="Período">
        <button
          type="button"
          role="tab"
          id="tab-upcoming"
          className="sched-tab"
          aria-selected={tab === 'upcoming'}
          aria-controls="panel-shifts"
          onClick={() => onTab('upcoming')}
        >
          Próximos ({upcoming.length})
        </button>
        <button
          type="button"
          role="tab"
          id="tab-past"
          className="sched-tab"
          aria-selected={tab === 'past'}
          aria-controls="panel-shifts"
          onClick={() => onTab('past')}
        >
          Anteriores ({past.length})
        </button>
      </div>
      <div role="tabpanel" id="panel-shifts" aria-labelledby={`tab-${tab}`}>
        {list.length === 0 ? (
          <p className="status muted">
            {tab === 'upcoming'
              ? 'Você não tem plantões publicados a partir de hoje.'
              : 'Nenhum plantão anterior nos últimos meses.'}
          </p>
        ) : (
          <ul className="sched-list">
            {list.map((shift) => (
              <ShiftItem
                key={shift.id}
                shift={shift}
                holidayName={data.holidays.get(shift.date)}
                actions={
                  renderActions ? (
                    renderActions(shift)
                  ) : (
                    <SwapRequestAction shift={shift} today={today} />
                  )
                }
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
