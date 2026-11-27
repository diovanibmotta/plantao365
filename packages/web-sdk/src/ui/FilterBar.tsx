import type { ReactNode } from 'react';
import './ui.css';

/** Barra de filtros da listagem: busca textual sempre presente, filtros da tela e "Limpar filtros". */
export function FilterBar({
  search,
  onSearch,
  placeholder,
  onClear,
  clearable,
  children,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  onClear: () => void;
  /** Há algum filtro ativo; o botão só aparece nesse caso. */
  clearable: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="ui-filters" role="search">
      <div className="ui-search">
        <svg
          className="ui-search-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={search}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      {children}
      {clearable && (
        <button type="button" className="btn" onClick={onClear}>
          Limpar filtros
        </button>
      )}
    </div>
  );
}

/** Texto de busca sem acento e em minúsculas, para comparar sem diferenciar caixa e acentuação. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}
