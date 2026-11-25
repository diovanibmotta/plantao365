import type { ReactNode } from 'react';
import './ui.css';

/** Estado vazio: convite curto e, quando couber, o CTA de cadastro. */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <p>{children}</p>
      {action}
    </div>
  );
}
