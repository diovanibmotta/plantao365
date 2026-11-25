import type { ReactNode } from 'react';
import './ui.css';

/** Cabeçalho da listagem: título, descrição de uma linha e o CTA principal (único botão de destaque). */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ui-header">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
