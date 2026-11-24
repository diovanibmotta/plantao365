export type ToastKind = 'success' | 'warning' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

/** Duração (ms) por tipo: erros ficam mais tempo na tela. */
export const TOAST_DURATION: Record<ToastKind, number> = {
  success: 4000,
  warning: 7000,
  error: 8000,
};

const MAX_VISIBLE = 4;

type Listener = () => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

function push(kind: ToastKind, message: string): number {
  const text = message.trim();
  if (!text) return -1;
  // Evita empilhar o mesmo aviso repetido (ex.: duplo clique).
  const dup = items.find((t) => t.kind === kind && t.message === text);
  if (dup) return dup.id;
  const id = nextId++;
  items = [...items, { id, kind, message: text }].slice(-MAX_VISIBLE);
  emit();
  return id;
}

export const toast = {
  success: (message: string) => push('success', message),
  warning: (message: string) => push('warning', message),
  error: (message: string) => push('error', message),
  dismiss(id: number): void {
    items = items.filter((t) => t.id !== id);
    emit();
  },
  clear(): void {
    items = [];
    emit();
  },
};

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): ToastItem[] {
  return items;
}
