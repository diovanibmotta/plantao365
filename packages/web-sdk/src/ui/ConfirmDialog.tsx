import { useEffect, useRef, type ReactNode } from 'react';

/** Confirmação de ação destrutiva; o texto diz o efeito da exclusão. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancelar',
  children,
  busy = false,
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Conteúdo extra abaixo da mensagem. */
  children?: ReactNode;
  busy?: boolean;
  /** danger: ação destrutiva (excluir); primary: confirmação comum (publicar). */
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div
      className="ui-overlay"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="ui-dialog" role="dialog" aria-modal="true" aria-labelledby="ui-dialog-title">
        <h2 id="ui-dialog-title">{title}</h2>
        <p>{message}</p>
        {children}
        <div className="ui-dialog-actions">
          <button type="button" className="btn" ref={cancel} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'btn ui-danger' : 'btn primary'}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
