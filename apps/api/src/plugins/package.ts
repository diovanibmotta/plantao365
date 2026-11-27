import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  checkPluginStyles,
  encodePackage as encode,
  PACKAGE_FORMAT,
} from '@diovanibmotta/plantao365-plugin-sdk';
import { z } from 'zod';
import {
  KERNEL_API_VERSION,
  packagePath,
  PluginError,
  pluginManifestSchema,
  type PluginManifest,
} from './types.js';

// Formato do pacote definido no plugin-sdk (a CLI gera, o kernel lê).
export { PACKAGE_FORMAT };
export const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;

const packageSchema = z.object({
  format: z.literal(PACKAGE_FORMAT),
  manifest: pluginManifestSchema,
  files: z.record(packagePath, z.string()),
});

export interface PluginPackage {
  manifest: PluginManifest;
  files: Map<string, Buffer>;
}

/** Monta o arquivo do pacote com o manifesto tipado (testes). */
export const encodePackage = (manifest: PluginManifest, files: Record<string, string | Buffer>) =>
  encode(manifest, files);

export function decodePackage(archive: Buffer): PluginPackage {
  if (archive.length > MAX_ARCHIVE_BYTES) {
    throw new PluginError('invalid_package', 'O pacote excede o tamanho máximo de 10 MB.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(gunzipSync(archive, { maxOutputLength: MAX_UNPACKED_BYTES }).toString('utf8'));
  } catch {
    throw new PluginError('invalid_package', 'Pacote de plugin ilegível.');
  }
  const parsed = packageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PluginError('invalid_package', 'Pacote de plugin inválido: manifesto ou arquivos.');
  }
  const { manifest, files } = parsed.data;
  const map = new Map(Object.entries(files).map(([p, b64]) => [p, Buffer.from(b64, 'base64')]));
  for (const entry of [manifest.server?.entry, manifest.web?.entry]) {
    if (entry && !map.has(entry)) {
      throw new PluginError('invalid_package', `Arquivo ${entry} do manifesto não está no pacote.`);
    }
  }
  return { manifest, files: map };
}

/**
 * Gate de identidade visual, só no install: pacote com front precisa de `styleCheck: "passed"`
 * (gravado pela CLI) e o kernel confere o CSS de novo. Não roda na ativação, para que um lint
 * mais rígido num kernel futuro não derrube plugins já instalados.
 */
export function assertStyleCheck({ manifest, files }: PluginPackage): void {
  if (manifest.web && manifest.styleCheck !== 'passed') {
    throw new PluginError(
      'invalid_package',
      'O pacote não passou pelo lint de estilo da CLI (styleCheck ausente no manifesto).',
    );
  }
  const violations = [...files]
    .filter(([p]) => p.endsWith('.css'))
    .flatMap(([p, content]) => checkPluginStyles(content.toString('utf8'), manifest.id, p));
  if (violations.length > 0) {
    const first = violations
      .slice(0, 3)
      .map((v) => `${v.file}:${v.line} ${v.message}`)
      .join(' ');
    throw new PluginError('invalid_package', `Estilo do plugin reprovado: ${first}`);
  }
}

/** Chaves públicas Ed25519 em base64 (DER/SPKI), separadas por vírgula. */
export function parsePublicKeys(list: string | undefined): KeyObject[] {
  return (list ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => {
      const key = createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' });
      if (key.asymmetricKeyType !== 'ed25519') {
        throw new Error('PLUGIN_PUBLIC_KEYS aceita apenas chaves Ed25519');
      }
      return key;
    });
}

export function verifySignature(archive: Buffer, signature: Buffer, keys: KeyObject[]): void {
  if (keys.length === 0) {
    throw new PluginError(
      'plugins_disabled',
      'Nenhuma chave confiável: cadastre a chave do publicador em Plugins › Chaves.',
    );
  }
  if (!keys.some((key) => verify(null, archive, key, signature))) {
    throw new PluginError('invalid_signature', 'Assinatura do pacote inválida.');
  }
}

const parts = (v: string) => v.split('.').map(Number) as [number, number, number];

/** `^a.b.c` aceita o kernel com o mesmo major e minor/patch iguais ou mais novos. */
export function isKernelCompatible(range: string, kernel = KERNEL_API_VERSION): boolean {
  const [ma, mi, pa] = parts(range.slice(1));
  const [ka, ki, kp] = parts(kernel);
  return ma === ka && (ki > mi || (ki === mi && kp >= pa));
}

export const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
