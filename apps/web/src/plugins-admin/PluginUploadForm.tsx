import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ConfirmDialog, FormActions, FormPage, FormSection } from '@plantao365/web-sdk';
import { api } from '../api/client';
import { usePlugins } from '../plugins/PluginContext';
import { PLUGINS_PATH } from './paths';
import './plugins-admin.css';

const MAX_BYTES = 10 * 1024 * 1024;

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });

/** Install manual de um pacote local (.p365 + .sig). */
export function PluginUploadForm() {
  const navigate = useNavigate();
  const [archive, setArchive] = useState<File | null>(null);
  const [signature, setSignature] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { reload } = usePlugins();
  const back = () => void navigate(PLUGINS_PATH);

  const askToInstall = () => {
    if (!archive || !signature) return setError('Escolha o pacote e a assinatura.');
    if (archive.size > MAX_BYTES) return setError('O pacote excede o tamanho máximo de 10 MB.');
    setConfirming(true);
  };

  const install = async () => {
    if (!archive || !signature) return;
    setBusy(true);
    try {
      await api.post('/api/plugins', {
        archive: await toBase64(archive),
        signature: await toBase64(signature),
      });
      back();
    } catch {
      // erro exibido pelo toast do interceptor
      setConfirming(false);
    } finally {
      reload();
      setBusy(false);
    }
  };

  const picker = (label: string, accept: string, set: (f: File | null) => void) => (
    <label className="ui-field ui-field--wide">
      {label}
      <input
        type="file"
        accept={accept}
        onChange={(e) => {
          setError(null);
          set(e.target.files?.[0] ?? null);
        }}
      />
    </label>
  );

  return (
    <>
      <FormPage
        crumbs={[{ label: 'Plugins', to: PLUGINS_PATH }, { label: 'Instalar de arquivo' }]}
        title="Instalar de arquivo"
        onSubmit={askToInstall}
      >
        <FormSection
          title="Pacote"
          description="Gerado por plantao-plugin pack e sign. A assinatura precisa conferir com uma chave confiável (veja a aba Chaves)."
        >
          <p className="plugins-warning ui-field--wide">
            <strong>Atenção: instalar um plugin executa código no servidor, sem isolamento.</strong>{' '}
            Ele pode ler, alterar e apagar dados (inclusive pessoais), acessar as credenciais da
            aplicação e enviar informações para fora. A assinatura confirma quem publicou, não que o
            código é seguro. Instale apenas plugins de quem você confia.
          </p>
          {picker('Pacote (.p365)', '.p365', setArchive)}
          {picker('Assinatura (.sig)', '.sig', setSignature)}
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
        </FormSection>
        <FormActions busy={busy} onCancel={back} saveLabel="Instalar" />
      </FormPage>
      {confirming && archive && (
        <ConfirmDialog
          title={`Instalar “${archive.name}”?`}
          message="O código deste pacote vai rodar no servidor, com acesso aos dados de todas as equipes. Confirme apenas se você confia em quem o publicou e aceita o risco."
          confirmLabel="Aceito o risco, instalar"
          busy={busy}
          onConfirm={() => void install()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
