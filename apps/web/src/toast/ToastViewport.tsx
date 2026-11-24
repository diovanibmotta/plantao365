import { useEffect, useSyncExternalStore } from 'react';
import { TOAST_DURATION, getToasts, subscribeToasts, toast, type ToastItem } from './toast-store';
import './toast.css';

const LABEL = { success: 'Sucesso', warning: 'Atenção', error: 'Erro' } as const;

function ToastCard({ item }: { item: ToastItem }) {
  useEffect(() => {
    const timer = setTimeout(() => toast.dismiss(item.id), TOAST_DURATION[item.kind]);
    return () => clearTimeout(timer);
  }, [item.id, item.kind]);

  return (
    <div className={`toast toast--${item.kind}`}>
      <span className="toast-label" aria-hidden="true">
        {LABEL[item.kind]}
      </span>
      <span className="toast-message" role={item.kind === 'success' ? 'status' : 'alert'}>
        {item.message}
      </span>
      <button
        type="button"
        className="toast-close"
        aria-label="Fechar notificação"
        onClick={() => toast.dismiss(item.id)}
      >
        ×
      </button>
    </div>
  );
}

/** Container fixo das notificações; montar uma única vez na raiz da aplicação. */
export function ToastViewport() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  return (
    <div className="toast-viewport" aria-label="Notificações">
      {items.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>
  );
}
