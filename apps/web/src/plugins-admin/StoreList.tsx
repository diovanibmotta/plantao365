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
import { storePluginPath } from './paths';
import { STORE_LABELS, storeState, type StoreItem, type StoreState } from './types';
import { useLoad } from './useLoad';

/** Catálogo da loja com o estado de cada plugin nesta instância. */
export function StoreList() {
  const navigate = useNavigate();
  const { data, error } = useLoad<{ plugins: StoreItem[] }>('/api/plugins/catalog');
  const items = data?.plugins;
  const [search, setSearch] = useState('');
  const [state, setState] = useState<'' | StoreState>('');

  const visible = useMemo(() => {
    const term = normalizeSearch(search);
    return (items ?? []).filter(
      (p) =>
        (!term || normalizeSearch(`${p.name} ${p.id} ${p.description ?? ''}`).includes(term)) &&
        (!state || storeState(p) === state),
    );
  }, [items, search, state]);
  const pager = usePagination(visible, `${search}|${state}`);

  return (
    <section>
      <PageHeader title="Loja de plugins" description="Plugins publicados na loja." />
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
      {items?.length === 0 && <EmptyState>Nenhum plugin publicado na loja.</EmptyState>}
      {items && items.length > 0 && (
        <>
          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder="Buscar por nome ou descrição"
            onClear={() => {
              setSearch('');
              setState('');
            }}
            clearable={Boolean(search || state)}
          >
            <select
              aria-label="Situação"
              value={state}
              onChange={(e) => setState(e.target.value as '' | StoreState)}
            >
              <option value="">Qualquer situação</option>
              {Object.entries(STORE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FilterBar>
          {visible.length === 0 ? (
            <p className="muted">Nenhum registro encontrado para os filtros aplicados.</p>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table" aria-label="Loja de plugins">
                <thead>
                  <tr>
                    <th scope="col">Nome</th>
                    <th scope="col">Versão</th>
                    <th scope="col">Situação</th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => void navigate(storePluginPath(p.id))}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        {p.name}
                        {p.description && <span className="muted block">{p.description}</span>}
                      </td>
                      <td>{p.latest ?? '—'}</td>
                      <td>
                        {STORE_LABELS[storeState(p)]}
                        {p.installedVersion && (
                          <span className="muted block">Instalada: {p.installedVersion}</span>
                        )}
                      </td>
                      <td className="ui-col-actions">
                        <Link
                          to={storePluginPath(p.id)}
                          className="btn sm"
                          aria-label={`Abrir ${p.name}`}
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          Abrir
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
