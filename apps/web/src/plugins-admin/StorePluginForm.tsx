import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { FormActions, FormPage, FormSection } from '@diovanibmotta/plantao365-web-sdk';
import { api } from '../api/client';
import { LoadError } from './LoadError';
import { pluginAdminPath, pluginsTabPath } from './paths';
import type { StoreItem } from './types';
import { useLoad } from './useLoad';

/** Detalhe de um plugin da loja: escolhe a versão e instala (ou atualiza). */
export function StorePluginForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const back = pluginsTabPath('store');
  const { data, error } = useLoad<{ plugins: StoreItem[] }>('/api/plugins/catalog');
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const item = data?.plugins.find((p) => p.id === id);
  const crumbs = [{ label: 'Loja de plugins', to: back }, { label: item?.name ?? 'Plugin' }];

  if (error || (data && !item)) {
    return (
      <LoadError crumbs={crumbs} back={back} message={error ?? 'Plugin não encontrado na loja.'} />
    );
  }
  if (!item) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }

  const version = chosen ?? item.latest ?? '';
  const installed = version !== '' && version === item.installedVersion;

  const install = async () => {
    setBusy(true);
    try {
      await api.post(`/api/plugins/catalog/${item.id}/install`, { version });
      void navigate(pluginAdminPath(item.id));
    } catch {
      // erro exibido pelo toast do interceptor
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormPage
      crumbs={crumbs}
      title={item.name}
      description={item.description ?? item.id}
      onSubmit={() => void install()}
    >
      <FormSection
        title="Instalação"
        description="O plugin executa código no servidor. Se for de outro publicador, cadastre antes a chave dele na aba Chaves. Depois de instalar, habilite-o; um plugin já habilitado recebe a versão nova na hora."
      >
        <label className="ui-field ui-field--wide">
          Versão
          <select value={version} onChange={(e) => setChosen(e.target.value)}>
            {!item.latest && <option value="">—</option>}
            {item.versions.map((v) => (
              <option key={v.version} value={v.version} disabled={!v.compatible}>
                {v.version}
                {v.compatible ? '' : ' (incompatível)'}
              </option>
            ))}
          </select>
        </label>
        {item.installedVersion && <p>Versão instalada: {item.installedVersion}</p>}
        {!item.latest && (
          <p className="alert" role="alert">
            Nenhuma versão é compatível com esta instalação do Plantão365.
          </p>
        )}
        {item.repository && (
          <p>
            <a href={item.repository} target="_blank" rel="noreferrer">
              Código-fonte
            </a>
          </p>
        )}
      </FormSection>
      <FormActions
        busy={busy}
        onCancel={() => void navigate(back)}
        saveDisabled={!version || installed}
        saveLabel={installed ? 'Já instalada' : item.installedVersion ? 'Atualizar' : 'Instalar'}
      />
    </FormPage>
  );
}
