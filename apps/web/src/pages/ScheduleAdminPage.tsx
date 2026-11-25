import { useSearchParams } from 'react-router';
import { SchedulesList } from '../schedule-admin/SchedulesList';
import { ShiftExceptionsList } from '../schedule-admin/ShiftExceptionsList';
import { ShiftTimesList } from '../schedule-admin/ShiftTimesList';
import { WorkHoursList } from '../schedule-admin/WorkHoursList';
import type { ScheduleAdminTab } from '../schedule-admin/paths';
import '../schedule-admin/schedule-admin.css';
import { PageTitle } from '../team/PageTitle';

const TABS: { id: ScheduleAdminTab; label: string }[] = [
  { id: 'schedules', label: 'Escalas' },
  { id: 'times', label: 'Horários dos plantões' },
  { id: 'exceptions', label: 'Exceções' },
  { id: 'work-hours', label: 'Jornada de trabalho' },
];

/** Gerenciamento da escala: cada aba é uma listagem; cadastro e edição abrem em rotas próprias. */
export function ScheduleAdminPage() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: ScheduleAdminTab = TABS.find((t) => t.id === tabParam)?.id ?? 'schedules';
  const setTab = (next: ScheduleAdminTab) => setParams(next === 'schedules' ? {} : { tab: next });

  return (
    <section>
      <div className="sad-head">
        <PageTitle>Escala</PageTitle>
      </div>
      <div className="sad-tabs" role="tablist" aria-label="Seções da escala">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`sad-tab-${t.id}`}
            className="sad-tab"
            aria-selected={tab === t.id}
            aria-controls="sad-panel"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="sad-panel" role="tabpanel" aria-labelledby={`sad-tab-${tab}`}>
        {tab === 'schedules' && <SchedulesList />}
        {tab === 'times' && <ShiftTimesList />}
        {tab === 'exceptions' && <ShiftExceptionsList />}
        {tab === 'work-hours' && <WorkHoursList />}
      </div>
    </section>
  );
}
