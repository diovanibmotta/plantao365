import { useState } from 'react';
import { useNavigate } from 'react-router';
import { FormActions, FormPage, FormSection } from '@plantao365/web-sdk';
import { api } from '../api/client';
import { PLUGINS_PATH } from './paths';

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
  const back = () => void navigate(PLUGINS_PATH);

  const install = async () => {
    if (!archive || !signature) return setError('Escolha o pacote e a assinatura.');
    if (archive.size > MAX_BYTES) return setError('O pacote excede o tamanho máximo de 10 MB.');
    setBusy(true);
    try {
      await api.post('/api/plugins', {
        archive: await toBase64(archive),
        signature: await toBase64(signature),
      });
      back();
    } catch {
      // erro exibido pelo toast do interceptor
    } finally {
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
    <FormPage
      crumbs={[{ label: 'Plugins', to: PLUGINS_PATH }, { label: 'Instalar de arquivo' }]}
      title="Instalar de arquivo"
      onSubmit={() => void install()}
    >
      <FormSection
        title="Pacote"
        description="Gerado por plantao-plugin pack e sign. A assinatura precisa conferir com uma chave confiável (veja a aba Chaves); o plugin executa código no servidor."
      >
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
  );
}
