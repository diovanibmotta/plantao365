/** Aviso de impacto em escala publicada que o usuário precisa confirmar antes de salvar. */
export interface ImpactConfirmation {
  message: string;
  /** Datas AAAA-MM-DD com plantão publicado afetado. */
  dates: string[];
}

interface Pending extends ImpactConfirmation {
  resolve: (confirmed: boolean) => void;
}

type Listener = () => void;

let pending: Pending | null = null;
const listeners = new Set<Listener>();

const emit = () => listeners.forEach((l) => l());

/** Abre o diálogo de confirmação e resolve com a escolha do usuário (Sim = true). */
export function requestImpactConfirmation(req: ImpactConfirmation): Promise<boolean> {
  pending?.resolve(false);
  return new Promise<boolean>((resolve) => {
    pending = { ...req, resolve };
    emit();
  });
}

export function answerImpactConfirmation(confirmed: boolean): void {
  const current = pending;
  pending = null;
  emit();
  current?.resolve(confirmed);
}

export function getImpactConfirmation(): ImpactConfirmation | null {
  return pending;
}

export function subscribeImpactConfirmation(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
