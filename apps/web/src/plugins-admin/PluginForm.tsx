import { useEffect, useId, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ConfirmDialog, FormActions, FormPage, FormSection } from '@plantao365/web-sdk';
import { api } from '../api/client';
import { usePlugins } from '../plugins/PluginContext';
import { PLUGINS_PATH } from './paths';
import {
  STATUS_LABELS,
  toFormValues,
  toSettings,
  validateValues,
  type PluginSummary,
  type SettingsField,
  type SettingsValues,
} from './types';

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Situação, configuração (gerada do settingsSchema) e remoção de um plugin. */
export function PluginForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fieldId = useId();
  const { reload } = usePlugins();
  const [plugin, setPlugin] = useState<PluginSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [values, setValues] = useState<SettingsValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [purge, setPurge] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ plugin: PluginSummary }>(`/api/plugins/${id}`, controller.signal)
      .then(({ plugin: p }) => {
        setPlugin(p);
        setEnabled(p.status === 'enabled');
        setValues(toFormValues(p.settingsSchema, p.settings));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar o plugin.');
      });
    return () => controller.abort();
  }, [id]);

  const back = () => void navigate(PLUGINS_PATH);
  const crumbs = [{ label: 'Plugins', to: PLUGINS_PATH }, { label: plugin?.name ?? 'Plugin' }];

  if (loadError) {
    return (
      <FormPage crumbs={crumbs} title="Plugin" onSubmit={back}>
        <p className="alert" role="alert">
          {loadError}
        </p>
        <div className="ui-actions">
          <button type="button" className="btn" onClick={back}>
            Voltar para a listagem
          </button>
        </div>
      </FormPage>
    );
  }
  if (!plugin) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }

  const schema = plugin.settingsSchema;
  const settings = toSettings(schema, values);
  const settingsChanged = !sameJson(
    settings,
    toSettings(schema, toFormValues(schema, plugin.settings)),
  );
  const statusChanged = enabled !== (plugin.status === 'enabled');

  const save = async () => {
    const found = validateValues(schema, values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (!settingsChanged && !statusChanged) return back();
    setBusy(true);
    try {
      // Configuração antes de habilitar: o plugin já sobe com os valores novos.
      if (settingsChanged) {
        await api.put(
          `/api/plugins/${plugin.id}/settings`,
          { settings },
          {
            ...(statusChanged ? { silentSuccess: true } : { successMessage: 'Plugin salvo.' }),
          },
        );
      }
      if (statusChanged) {
        await api.post(`/api/plugins/${plugin.id}/${enabled ? 'enable' : 'disable'}`, undefined, {
          successMessage: enabled ? 'Plugin habilitado.' : 'Plugin desabilitado.',
        });
      }
      back();
    } catch {
      // erro exibido pelo toast do interceptor
    } finally {
      reload();
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/api/plugins/${plugin.id}${purge ? '?purge=true' : ''}`);
      setConfirmingDelete(false);
      back();
    } catch {
      setConfirmingDelete(false);
    } finally {
      reload();
      setBusy(false);
    }
  };

  const field = (key: string, f: SettingsField) => {
    const id = `${fieldId}-${key}`;
    const value = values[key];
    const set = (v: string | boolean) => {
      setErrors({});
      setValues((all) => ({ ...all, [key]: v }));
    };
    const error = errors[key] && (
      <span className="ui-field-error" role="alert">
        {errors[key]}
      </span>
    );
    const hint = f.description && <span className="muted block">{f.description}</span>;
    if (f.type === 'boolean') {
      return (
        <label key={key} className="ui-field ui-field--wide">
          <span>
            <input
              type="checkbox"
              checked={value === true}
              onChange={(e) => set(e.target.checked)}
            />{' '}
            {f.title}
          </span>
          {hint}
        </label>
      );
    }
    return (
      <label key={key} className="ui-field ui-field--wide" htmlFor={id}>
        {f.title}
        {f.enum ? (
          <select id={id} value={String(value)} onChange={(e) => set(e.target.value)}>
            <option value="">—</option>
            {f.enum.map((o) => (
              <option key={String(o)} value={String(o)}>
                {String(o)}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            type={
              f.type !== 'string'
                ? 'number'
                : f.format === 'email'
                  ? 'email'
                  : f.format === 'uri'
                    ? 'url'
                    : 'text'
            }
            {...(f.type === 'integer' && { step: 1 })}
            value={String(value)}
            aria-invalid={errors[key] ? true : undefined}
            onChange={(e) => set(e.target.value)}
          />
        )}
        {hint}
        {error}
      </label>
    );
  };

  return (
    <>
      <FormPage
        crumbs={crumbs}
        title={plugin.name}
        description={plugin.description ?? `Versão ${plugin.version}.`}
        onSubmit={() => void save()}
      >
        <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0 }}>
          <FormSection title="Situação" description="Versão instalada e se o plugin está ativo.">
            <p>
              {plugin.id} · versão {plugin.version} · {STATUS_LABELS[plugin.status]}
            </p>
            {plugin.error && (
              <p className="alert" role="alert">
                {plugin.error}
              </p>
            )}
            <label className="ui-field ui-field--wide">
              <span>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />{' '}
                Habilitado
              </span>
            </label>
          </FormSection>
          <FormSection title="Configuração" description="Campos declarados pelo próprio plugin.">
            {schema && Object.keys(schema.properties).length > 0 ? (
              <div className="ui-fields">
                {Object.entries(schema.properties).map(([key, f]) => field(key, f))}
              </div>
            ) : (
              <p className="muted">Este plugin não tem configuração.</p>
            )}
          </FormSection>
        </fieldset>
        <FormActions
          busy={busy}
          onCancel={back}
          deleteLabel="Remover"
          onDelete={() => setConfirmingDelete(true)}
        />
      </FormPage>
      {confirmingDelete && (
        <ConfirmDialog
          title={`Remover “${plugin.name}”?`}
          message="O plugin sai do menu e das telas e para de rodar em todas as réplicas."
          confirmLabel="Remover"
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmingDelete(false)}
        >
          <label>
            <input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} />{' '}
            Apagar também os dados do plugin (não pode ser desfeito)
          </label>
        </ConfirmDialog>
      )}
    </>
  );
}
