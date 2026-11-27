import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ConfirmDialog, FormActions, FormPage, FormSection } from '@plantao365/web-sdk';
import { api } from '../api/client';
import { LoadError } from './LoadError';
import { pluginsTabPath } from './paths';
import type { TrustedKey } from './types';
import { useLoad } from './useLoad';

/** Cadastro e edição de uma chave confiável (a chave em si não muda depois de criada). */
export function KeyForm() {
  const { keyId } = useParams<{ keyId: string }>();
  const { data, error } = useLoad<{ keys: TrustedKey[] }>('/api/plugins/keys');
  const back = pluginsTabPath('keys');
  const current = data?.keys.find((k) => k.id === keyId);
  const crumbs = [
    { label: 'Chaves confiáveis', to: back },
    { label: keyId ? (current?.name ?? 'Chave') : 'Nova chave' },
  ];

  if (error || (keyId && data && !current)) {
    return <LoadError crumbs={crumbs} back={back} message={error ?? 'Chave não encontrada.'} />;
  }
  if (!data) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }
  return <Fields key={keyId} crumbs={crumbs} current={current} keys={data.keys} />;
}

function Fields({
  crumbs,
  current,
  keys,
}: {
  crumbs: { label: string; to?: string }[];
  current: TrustedKey | undefined;
  keys: TrustedKey[];
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(current?.name ?? '');
  const [publicKey, setPublicKey] = useState(current?.publicKey ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const back = () => void navigate(pluginsTabPath('keys'));
  const duplicated = !current && keys.some((k) => k.publicKey === publicKey.trim());

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      back();
    } catch {
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!name.trim() || !publicKey.trim()) return setError('Informe o nome e a chave pública.');
    void run(() =>
      current
        ? api.put(`/api/plugins/keys/${current.id}`, { name: name.trim() })
        : api.post('/api/plugins/keys', { name: name.trim(), publicKey: publicKey.trim() }),
    );
  };

  return (
    <>
      <FormPage crumbs={crumbs} title={current?.name ?? 'Nova chave'} onSubmit={save}>
        <FormSection
          title="Publicador"
          description="Só instalam aqui pacotes assinados por uma chave confiável. Cadastre a chave pública de quem publica o plugin. Atenção: o que for assinado com esta chave executa código no servidor."
        >
          <label className="ui-field ui-field--wide">
            Nome
            <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="ui-field ui-field--wide">
            Chave pública
            <textarea
              rows={3}
              value={publicKey}
              readOnly={Boolean(current)}
              onChange={(e) => setPublicKey(e.target.value)}
            />
          </label>
          <p className="muted">
            Peça a chave pública ao publicador (é o texto que o comando plantao-plugin keygen
            mostra). Nunca cole a chave privada.
          </p>
          {(error || duplicated) && (
            <p className="alert" role="alert">
              {duplicated ? 'Esta chave já está cadastrada.' : error}
            </p>
          )}
        </FormSection>
        <FormActions
          busy={busy}
          onCancel={back}
          saveDisabled={duplicated}
          onDelete={current ? () => setConfirming(true) : undefined}
        />
      </FormPage>
      {confirming && current && (
        <ConfirmDialog
          title={`Excluir a chave “${current.name}”?`}
          message="Novos pacotes assinados com ela serão recusados. Plugins já instalados continuam funcionando."
          confirmLabel="Excluir"
          busy={busy}
          onConfirm={() => void run(() => api.delete(`/api/plugins/keys/${current.id}`))}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
