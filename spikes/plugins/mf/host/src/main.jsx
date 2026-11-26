import { Component, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { registerRemotes, loadRemote } from '@module-federation/runtime';
import { SdkContext } from '@spike/web-sdk';

class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <p data-testid="error">falha no plugin: {String(this.state.error.message)}</p>
    ) : (
      this.props.children
    );
  }
}

// Manifesto lido em runtime (na API real: GET /api/plugins/manifest).
const manifest = await fetch('/manifest.json', { cache: 'no-store' }).then((r) => r.json());
registerRemotes(manifest.plugins.map((p) => ({ name: p.id, entry: p.entry, type: 'module' })));

const views = manifest.plugins.map((p) => ({
  id: p.id,
  View: lazy(() => loadRemote(`${p.id}/web`)),
}));

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <SdkContext.Provider value="valor-do-host">
      <h1>host</h1>
      {views.map(({ id, View }) => (
        <Boundary key={id}>
          <Suspense fallback={<p>carregando {id}…</p>}>
            <View />
          </Suspense>
        </Boundary>
      ))}
    </SdkContext.Provider>
  </BrowserRouter>,
);
