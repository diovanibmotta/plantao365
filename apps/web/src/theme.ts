export type Theme = 'light' | 'dark';

const KEY = 'plantao360-theme';

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** Tema efetivo: escolha manual (data-theme) ou preferência do sistema. */
export function effectiveTheme(): Theme {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Aplica a escolha salva antes do primeiro render, para não piscar. */
export function initTheme(): void {
  const saved = stored();
  if (saved) document.documentElement.dataset.theme = saved;
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Sem armazenamento (modo privado): vale só nesta sessão.
  }
}
