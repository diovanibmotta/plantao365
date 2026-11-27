import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router';

export interface Crumb {
  label: string;
  to?: string;
}

/** Trilha de navegação no topo das telas de formulário. */
export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Navegação estrutural" className="ui-breadcrumb">
      {crumbs.map((c, i) => (
        <span key={c.label}>
          {i > 0 && <span aria-hidden="true">/ </span>}
          {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/** Tela de formulário: breadcrumb, título e seções; as ações ficam na barra fixa (FormActions). */
export function FormPage({
  crumbs,
  title,
  description,
  onSubmit,
  children,
}: {
  crumbs: Crumb[];
  title: string;
  description?: string;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <section>
      <Breadcrumb crumbs={crumbs} />
      <div className="ui-form-head">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <form onSubmit={submit} noValidate>
        {children}
      </form>
    </section>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="ui-section" aria-label={title}>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children}
    </section>
  );
}

/** Barra fixa: Excluir à esquerda (só na edição); Cancelar e Salvar à direita. */
export function FormActions({
  onCancel,
  onDelete,
  busy,
  saveDisabled = false,
  saveLabel = 'Salvar',
  deleteLabel = 'Excluir',
}: {
  onCancel: () => void;
  onDelete?: (() => void) | undefined;
  busy: boolean;
  /** Bloqueia o Salvar enquanto o formulário tem um problema visível (ex.: sobreposição). */
  saveDisabled?: boolean;
  saveLabel?: string;
  /** Rótulo do botão destrutivo (ex.: Desativar, quando o registro não é excluído de fato). */
  deleteLabel?: string;
}) {
  return (
    <div className="ui-actions">
      {onDelete && (
        <button type="button" className="btn ui-danger" disabled={busy} onClick={onDelete}>
          {deleteLabel}
        </button>
      )}
      <span className="ui-actions-spacer" />
      <button type="button" className="btn" onClick={onCancel}>
        Cancelar
      </button>
      <button type="submit" className="btn primary" disabled={busy || saveDisabled}>
        {busy ? 'Salvando…' : saveLabel}
      </button>
    </div>
  );
}
