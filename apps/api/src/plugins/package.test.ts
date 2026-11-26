import { generateKeyPairSync, sign } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  decodePackage,
  encodePackage,
  isKernelCompatible,
  parsePublicKeys,
  PACKAGE_FORMAT,
  verifySignature,
} from './package.js';
import type { PluginManifest } from './types.js';

const manifest: PluginManifest = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  kernelApi: '^1.0.0',
  server: { entry: 'server/index.js' },
};

const keyPair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const b64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return { privateKey, keys: parsePublicKeys(b64) };
};

describe('pacote de plugin', () => {
  it('codifica e decodifica manifesto e arquivos', () => {
    const pkg = decodePackage(encodePackage(manifest, { 'server/index.js': 'export default {}' }));
    expect(pkg.manifest).toEqual(manifest);
    expect(pkg.files.get('server/index.js')?.toString()).toBe('export default {}');
  });

  it('rejeita caminho com .. (path traversal)', () => {
    const archive = gzipSync(
      JSON.stringify({
        format: PACKAGE_FORMAT,
        manifest,
        files: { 'server/index.js': '', '../evil.js': '' },
      }),
    );
    expect(() => decodePackage(archive)).toThrow(/inválido/);
  });

  it('rejeita entry do manifesto ausente e conteúdo ilegível', () => {
    expect(() => decodePackage(encodePackage(manifest, {}))).toThrow(/server\/index.js/);
    expect(() => decodePackage(Buffer.from('lixo'))).toThrow(/ilegível/);
  });

  it('verifica a assinatura Ed25519 e recusa pacote alterado ou sem chaves', () => {
    const { privateKey, keys } = keyPair();
    const archive = encodePackage(manifest, { 'server/index.js': 'x' });
    const signature = sign(null, archive, privateKey);
    expect(() => verifySignature(archive, signature, keys)).not.toThrow();

    const tampered = Buffer.from(archive);
    tampered[tampered.length - 1] ^= 1;
    expect(() => verifySignature(tampered, signature, keys)).toThrow(/Assinatura/);
    expect(() => verifySignature(archive, signature, keyPair().keys)).toThrow(/Assinatura/);
    expect(() => verifySignature(archive, signature, [])).toThrow(/PLUGIN_PUBLIC_KEYS/);
  });

  it('checa compatibilidade com o contrato do kernel', () => {
    expect(isKernelCompatible('^1.0.0', '1.0.0')).toBe(true);
    expect(isKernelCompatible('^1.0.0', '1.3.0')).toBe(true);
    expect(isKernelCompatible('^1.2.0', '1.1.9')).toBe(false);
    expect(isKernelCompatible('^1.1.3', '1.1.2')).toBe(false);
    expect(isKernelCompatible('^2.0.0', '1.9.9')).toBe(false);
  });
});
