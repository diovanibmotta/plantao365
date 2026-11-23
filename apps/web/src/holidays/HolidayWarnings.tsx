import type { ReactNode } from 'react';
import { formatDay, warningMessage } from './types';
import type { HolidayWarning } from './types';

interface Props {
  warnings: HolidayWarning[];
  onDismiss: () => void;
  action?: ReactNode;
}

export function HolidayWarnings({ warnings, onDismiss, action }: Props) {
  if (warnings.length === 0) return null;
  return (
    <div className="holidays-warning" role="status" aria-label="Aviso de impacto">
      <ul>
        {warnings.map((w) => (
          <li key={w.date}>
            <strong>{formatDay(w.date)}:</strong> {warningMessage(w.count)}
          </li>
        ))}
      </ul>
      <div className="holidays-warning-actions">
        {action}
        <button type="button" className="btn" onClick={onDismiss}>
          Dispensar
        </button>
      </div>
    </div>
  );
}
