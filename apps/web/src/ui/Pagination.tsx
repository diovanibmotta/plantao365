import { useMemo, useState } from 'react';
import './ui.css';

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Paginação no cliente: fatia a lista já filtrada. Volta à página 1 quando o filtro (`resetKey`)
 * muda e mantém a página dentro do intervalo quando a lista encolhe.
 */
export function usePagination<T>(items: T[], resetKey: unknown, initialSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(initialSize);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages);

  // Filtro mudou: volta à página 1 (ajuste de estado durante o render, sem effect).
  const [seenKey, setSeenKey] = useState(resetKey);
  if (!Object.is(seenKey, resetKey)) {
    setSeenKey(resetKey);
    setPage(1);
  }

  const slice = useMemo(
    () => items.slice((current - 1) * pageSize, current * pageSize),
    [items, current, pageSize],
  );
  return {
    slice,
    page: current,
    pages,
    pageSize,
    setPage,
    setPageSize: (size: number) => {
      setPageSize(size);
      setPage(1);
    },
  };
}

/** Rodapé da listagem: contagem "N de M registros", tamanho da página e navegação. */
export function Pagination({
  total,
  filtered,
  page,
  pages,
  pageSize,
  onPage,
  onPageSize,
  noun = ['registro', 'registros'],
}: {
  /** Total sem filtros. */
  total: number;
  /** Total depois dos filtros. */
  filtered: number;
  page: number;
  pages: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  noun?: [string, string];
}) {
  return (
    <div className="ui-pagination">
      <p className="ui-count">
        {filtered} de {total} {total === 1 ? noun[0] : noun[1]}
      </p>
      <div className="ui-pagination-controls">
        <label className="ui-pagination-size">
          Por página
          <select
            aria-label="Registros por página"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label="Paginação" className="ui-pagination-nav">
          <button
            type="button"
            className="btn sm ui-pagination-btn"
            aria-label="Anterior"
            title="Anterior"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span aria-live="polite">
            {page} de {pages} {pages === 1 ? 'página' : 'páginas'}
          </span>
          <button
            type="button"
            className="btn sm ui-pagination-btn"
            aria-label="Próxima"
            title="Próxima"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </nav>
      </div>
    </div>
  );
}
