import type { ReactNode } from 'react';
import { DAY_TYPE_LABEL, formatDayShort, formatHours, formatPeriod } from './format';
import type { ShiftDto } from './types';

interface ShiftItemProps {
  shift: ShiftDto;
  holidayName?: string | undefined;
  actions?: ReactNode;
}

export function ShiftItem({ shift, holidayName, actions }: ShiftItemProps) {
  const tag =
    shift.dayType === 'holiday' && holidayName
      ? `${DAY_TYPE_LABEL.holiday}: ${holidayName}`
      : DAY_TYPE_LABEL[shift.dayType];
  return (
    <li className="sched-item" data-testid="shift-item">
      <div className="sched-item-main">
        <time className="sched-item-date" dateTime={shift.date}>
          {formatDayShort(shift.date)}
        </time>
        <span className={`sched-tag sched-tag--${shift.dayType}`}>{tag}</span>
      </div>
      <div className="sched-item-meta">
        <span>{formatPeriod(shift)}</span>
        <span className="muted">{formatHours(shift.hours)}</span>
      </div>
      {actions && <div className="sched-item-actions">{actions}</div>}
    </li>
  );
}
