import { useEffect, useRef, type ReactNode } from 'react';

/** Diálogo informativo (só leitura): título, conteúdo e um botão "Fechar". */
export function InfoDialog({
  title,
  children,
  closeLabel = 'Fechar',
  onClose,
}: {
  title: string;
  children: ReactNode;
  closeLabel?: string;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  return (
    <div
      className="ui-overlay"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-dialog" role="dialog" aria-modal="true" aria-labelledby="ui-info-title">
        <h2 id="ui-info-title">{title}</h2>
        {children}
        <div className="ui-dialog-actions">
          <button type="button" className="btn" ref={close} onClick={onClose}>
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
