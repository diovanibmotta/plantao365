import { gzipSync } from 'node:zlib';

/**
 * Pacote de plugin: gzip de um JSON `{ format, manifest, files: { caminho: base64 } }`.
 * A CLI gera (`pack`) e o kernel lê; a assinatura Ed25519 cobre os bytes do arquivo compactado.
 */
export const PACKAGE_FORMAT = 'plantao365-plugin@1';

export function encodePackage(manifest: object, files: Record<string, string | Uint8Array>) {
  const encoded = Object.fromEntries(
    Object.entries(files).map(([p, c]) => [p, Buffer.from(c).toString('base64')]),
  );
  return gzipSync(JSON.stringify({ format: PACKAGE_FORMAT, manifest, files: encoded }));
}
