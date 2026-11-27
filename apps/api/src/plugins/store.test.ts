import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addToCatalog, signFile } from '@diovanibmotta/plantao365-plugin-sdk/cli';
import { describe, expect, it, vi } from 'vitest';
import { encodePackage, sha256 } from './package.js';
import { createPluginStore, describeCatalogPlugin } from './store.js';

const BASE = 'https://store.example.com/catalog.json';
const archive = Buffer.from('pacote');

const catalog = (over: Record<string, unknown> = {}) => ({
  format: 1,
  plugins: [
    {
      id: 'demo',
      name: 'Demo',
      versions: [
        {
          version: '1.0.0',
          kernelApi: '^1.0.0',
          url: 'packages/demo/1.0.0/demo-1.0.0.p365',
          sha256: sha256(archive),
          signature: Buffer.from('assinatura').toString('base64'),
          ...over,
        },
      ],
    },
  ],
});

const fakeFetch = (index: unknown) =>
  vi.fn((url: URL | string | Request) =>
    Promise.resolve(
      String(url) === BASE ? new Response(JSON.stringify(index)) : new Response(archive),
    ),
  );

const store = (index: unknown) => {
  const fetchMock = fakeFetch(index);
  return { fetchMock, store: createPluginStore({ catalogUrl: BASE, fetch: fetchMock }) };
};

describe('loja de plugins', () => {
  it('baixa a versão pelo caminho relativo, sem seguir redirect, com índice em cache', async () => {
    const { store: s, fetchMock } = store(catalog());
    const got = await s.download('demo', '1.0.0');
    expect(got.archive.equals(archive)).toBe(true);
    expect(got.signature.toString()).toBe('assinatura');
    await s.catalog();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      BASE,
      'https://store.example.com/packages/demo/1.0.0/demo-1.0.0.p365',
    ]);
    expect(fetchMock.mock.calls[0]).toMatchObject([expect.anything(), { redirect: 'error' }]);
  });

  it('lê o catálogo que a CLI publica; versão publicada não muda de conteúdo', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'catalog-'));
    try {
      const file = path.join(dir, 'demo.p365');
      const pem = generateKeyPairSync('ed25519')
        .privateKey.export({ format: 'pem', type: 'pkcs8' })
        .toString();
      const publish = async (files: Record<string, string>) => {
        await writeFile(
          file,
          encodePackage({ id: 'demo', name: 'Demo', version: '1.0.0', kernelApi: '^1.0.0' }, files),
        );
        await signFile(file, pem);
        return addToCatalog(file, path.join(dir, 'store'), 'https://github.com/x/demo');
      };
      await publish({ 'server/index.js': 'a' });
      await publish({ 'server/index.js': 'a' });
      const published = createPluginStore({
        catalogUrl: BASE,
        fetch: async (url) =>
          new Response(
            await readFile(path.join(dir, 'store', new URL(String(url)).pathname.slice(1))),
          ),
      });
      expect((await published.catalog()).plugins[0]!.versions).toHaveLength(1);
      expect((await published.download('demo', '1.0.0')).archive.length).toBeGreaterThan(0);
      await expect(publish({ 'server/index.js': 'b' })).rejects.toThrow(/outro conteúdo/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('recusa pacote de outra origem, sha256 divergente e versão inexistente', async () => {
    const evil = store(catalog({ url: 'https://evil.example.com/x.p365' }));
    await expect(evil.store.download('demo', '1.0.0')).rejects.toMatchObject({
      code: 'store_unavailable',
    });
    expect(evil.fetchMock).toHaveBeenCalledTimes(1);
    await expect(
      store(catalog({ sha256: '0'.repeat(64) })).store.download('demo', '1.0.0'),
    ).rejects.toMatchObject({ code: 'invalid_package' });
    await expect(store(catalog()).store.download('demo', '2.0.0')).rejects.toMatchObject({
      code: 'plugin_not_found',
    });
  });

  it('índice inválido, grande demais ou fora do ar vira store_unavailable', async () => {
    const failing = [
      () => Promise.resolve(new Response('não é json')),
      () => Promise.resolve(new Response(JSON.stringify({ format: 2, plugins: [] }))),
      () => Promise.resolve(new Response('x'.repeat(1024 * 1024 + 1))),
      () => Promise.resolve(new Response('', { status: 403 })),
      () => Promise.reject(new TypeError('offline')),
    ];
    for (const impl of failing) {
      const s = createPluginStore({ catalogUrl: BASE, fetch: impl });
      await expect(s.catalog()).rejects.toMatchObject({ code: 'store_unavailable' });
    }
  });

  it('aponta a maior versão compatível e quando há atualização', () => {
    const plugin = {
      id: 'demo',
      name: 'Demo',
      versions: ['1.2.0', '1.10.0', '2.0.0'].map((version) => ({
        ...catalog().plugins[0]!.versions[0]!,
        version,
        kernelApi: version.startsWith('2') ? '^2.0.0' : '^1.0.0',
      })),
    };
    const compatible = (range: string) => range === '^1.0.0';
    expect(describeCatalogPlugin(plugin, '1.2.0', compatible)).toMatchObject({
      latest: '1.10.0',
      updateAvailable: true,
      versions: [
        { version: '2.0.0', compatible: false },
        { version: '1.10.0', compatible: true },
        { version: '1.2.0', compatible: true },
      ],
    });
    expect(describeCatalogPlugin(plugin, null, () => false)).toMatchObject({
      latest: null,
      updateAvailable: false,
    });
  });
});
