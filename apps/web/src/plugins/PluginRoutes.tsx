import { Route, Routes, useParams } from 'react-router';
import type { PluginRoute, Role } from '@diovanibmotta/plantao365-web-sdk';
import { NotFoundPage } from '../pages/pages';
import { useRole } from '../team/TeamContext';
import { PluginBoundary } from './PluginBoundary';
import { usePlugins } from './PluginContext';

const RANK: Record<Role, number> = { guest: 0, member: 1, manager: 2 };

function Gate({ route }: { route: PluginRoute }) {
  const role = useRole();
  const needed = route.role ?? 'member';
  if (!role || RANK[role] < RANK[needed]) {
    return (
      <section>
        <h1>Acesso restrito</h1>
        <p className="muted">
          {needed === 'manager'
            ? 'Esta página é exclusiva para gestores.'
            : 'Esta página é exclusiva para membros.'}
        </p>
      </section>
    );
  }
  const Page = route.component;
  return <Page />;
}

/** `/ext/:pluginId/*`: rotas declaradas pelo plugin, com papel e isolamento de erro. */
export function PluginRoutes() {
  const { pluginId } = useParams();
  const { plugins, loading } = usePlugins();
  if (loading) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }
  const plugin = plugins.find((p) => p.id === pluginId);
  if (!plugin) return <NotFoundPage />;
  if (!plugin.module) {
    return (
      <p className="alert" role="alert">
        Não foi possível carregar a extensão {plugin.name}.
      </p>
    );
  }
  // `plg-<id>` é o escopo exigido pelo lint de estilo: o CSS do plugin só atinge o que está aqui.
  return (
    <div className={`plg-${plugin.id}`}>
      <PluginBoundary name={plugin.name}>
        <Routes>
          {(plugin.module.routes ?? []).map((route) =>
            route.path === '' ? (
              <Route key="" index element={<Gate route={route} />} />
            ) : (
              <Route key={route.path} path={route.path} element={<Gate route={route} />} />
            ),
          )}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </PluginBoundary>
    </div>
  );
}
