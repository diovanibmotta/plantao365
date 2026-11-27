import { useSearchParams } from 'react-router';
import { KeysList } from '../plugins-admin/KeysList';
import type { PluginsTab } from '../plugins-admin/paths';
import { PluginsList } from '../plugins-admin/PluginsList';
import { StoreList } from '../plugins-admin/StoreList';
import '../schedule-admin/schedule-admin.css';

const TABS: { id: PluginsTab; label: string }[] = [
  { id: 'installed', label: 'Instalados' },
  { id: 'store', label: 'Loja' },
  { id: 'keys', label: 'Chaves' },
];

/** Gestão de plugins: instalados, loja e chaves confiáveis; formulários em rotas próprias. */
export function PluginsPage() {
  const [params, setParams] = useSearchParams();
  const tab: PluginsTab = TABS.find((t) => t.id === params.get('tab'))?.id ?? 'installed';
  const setTab = (next: PluginsTab) => setParams(next === 'installed' ? {} : { tab: next });

  return (
    <section>
      <div className="sad-tabs" role="tablist" aria-label="Seções de plugins">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`plugins-tab-${t.id}`}
            className="sad-tab"
            aria-selected={tab === t.id}
            aria-controls="plugins-panel"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="plugins-panel" role="tabpanel" aria-labelledby={`plugins-tab-${tab}`}>
        {tab === 'installed' && <PluginsList />}
        {tab === 'store' && <StoreList />}
        {tab === 'keys' && <KeysList />}
      </div>
    </section>
  );
}
