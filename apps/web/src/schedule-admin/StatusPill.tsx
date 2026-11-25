import type { ScheduleDto } from './types';

export function StatusPill({ status }: { status: ScheduleDto['status'] }) {
  return (
    <span className={`sad-pill sad-pill--${status}`}>
      {status === 'draft' ? 'Rascunho' : 'Publicada'}
    </span>
  );
}
