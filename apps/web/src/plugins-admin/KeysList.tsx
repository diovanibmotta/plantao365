import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  EmptyState,
  FilterBar,
  normalizeSearch,
  PageHeader,
  Pagination,
  usePagination,
} from '@diovanibmotta/plantao365-web-sdk';
import { keyPath, NEW_KEY_PATH } from './paths';
import type { TrustedKey } from './types';
import { useLoad } from './useLoad';

/** Chaves de publicadores aceitas além da loja oficial. */
export function KeysList() {
  const navigate = useNavigate();
  const { data, error } = useLoad<{ keys: TrustedKey[] }>('/api/plugins/keys');
  const items = data?.keys;
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const term = normalizeSearch(search);
    return (items ?? []).filter((k) => !term || normalizeSearch(k.name).includes(term));
  }, [items, search]);
  const pager = usePagination(visible, search);
  const cta = (
    <Link to={NEW_KEY_PATH} className="btn primary">
      Nova chave
    </Link>
  );

  return (
    <section>
      <PageHeader
        title="Chaves confiáveis"
        description="Publicadores aceitos além da loja oficial."
        action={cta}
      />
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {items?.length === 0 && <EmptyState action={cta}>Nenhuma chave cadastrada.</EmptyState>}
      {items && items.length > 0 && (
        <>
          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder="Buscar por nome"
            onClear={() => setSearch('')}
            clearable={Boolean(search)}
          />
          {visible.length === 0 ? (
            <p className="muted">Nenhum registro encontrado para os filtros aplicados.</p>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table" aria-label="Chaves confiáveis">
                <thead>
                  <tr>
                    <th scope="col">Nome</th>
                    <th scope="col">Chave pública</th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map((k) => (
                    <tr
                      key={k.id}
                      onClick={() => void navigate(keyPath(k.id))}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{k.name}</td>
                      <td>
                        <code>…{k.publicKey.slice(-16)}</code>
                      </td>
                      <td className="ui-col-actions">
                        <Link
                          to={keyPath(k.id)}
                          className="btn sm"
                          aria-label={`Editar ${k.name}`}
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          Editar
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            total={items.length}
            filtered={visible.length}
            page={pager.page}
            pages={pager.pages}
            pageSize={pager.pageSize}
            onPage={pager.setPage}
            onPageSize={pager.setPageSize}
          />
        </>
      )}
    </section>
  );
}
