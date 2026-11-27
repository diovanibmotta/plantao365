import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  EmptyState,
  FilterBar,
  normalizeSearch,
  PageHeader,
  Pagination,
  usePagination,
} from '@diovanibmotta/plantao365-web-sdk';
import { api } from '../api/client';
import { PLUGIN_UPLOAD_PATH, pluginAdminPath } from './paths';
import { STATUS_LABELS, type PluginStatus, type PluginSummary } from './types';

/** Plugins instalados: versão e situação. A gestão fica no formulário. */
export function PluginsList() {
  const navigate = useNavigate();
  const cta = (
    <Link to={PLUGIN_UPLOAD_PATH} className="btn primary">
      Instalar de arquivo
    </Link>
  );
  const [items, setItems] = useState<PluginSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | PluginStatus>('');

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ plugins: PluginSummary[] }>('/api/plugins', controller.signal)
      .then((r) => setItems(r.plugins))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Não foi possível carregar os plugins.');
      });
    return () => controller.abort();
  }, []);

  const visible = useMemo(() => {
    const term = normalizeSearch(search);
    return (items ?? []).filter(
      (p) =>
        (!term || normalizeSearch(`${p.name} ${p.id}`).includes(term)) &&
        (!status || p.status === status),
    );
  }, [items, search, status]);

  const pager = usePagination(visible, `${search}|${status}`);
  const clear = () => {
    setSearch('');
    setStatus('');
  };

  return (
    <section>
      <PageHeader
        title="Plugins"
        description="Extensões instaladas, a versão e a situação."
        action={cta}
      />
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {items === null && !error && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {items?.length === 0 && (
        <EmptyState action={cta}>
          Nenhum plugin instalado. Escolha um na aba Loja ou instale de arquivo.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <>
          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder="Buscar por nome ou id"
            onClear={clear}
            clearable={Boolean(search || status)}
          >
            <select
              aria-label="Situação"
              value={status}
              onChange={(e) => setStatus(e.target.value as '' | PluginStatus)}
            >
              <option value="">Qualquer situação</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
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
              <table className="ui-table" aria-label="Plugins">
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
                      onClick={() => void navigate(pluginAdminPath(p.id))}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        {p.name}
                        <span className="muted block">{p.id}</span>
                      </td>
                      <td>{p.version}</td>
                      <td>
                        {STATUS_LABELS[p.status]}
                        {p.error && <span className="muted block">{p.error}</span>}
                      </td>
                      <td className="ui-col-actions">
                        <Link
                          to={pluginAdminPath(p.id)}
                          className="btn sm"
                          aria-label={`Editar ${p.name}`}
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
