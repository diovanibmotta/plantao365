// Builda o host uma vez e o plugin demo em duas versões; o manifesto aponta para a v1.
// Trocar de versão = editar host/dist/manifest.json (sem rebuild do host).
import { build } from 'vite';
import { writeFile } from 'node:fs/promises';

await build({ configFile: 'host/vite.config.js' });
for (const v of ['1', '2']) {
  process.env.PLUGIN_VERSION = v;
  await build({ configFile: 'remote/vite.config.js' });
}
await writeFile(
  'host/dist/manifest.json',
  JSON.stringify(
    { plugins: [{ id: 'demo', entry: '/plugins-assets/demo/1/remoteEntry.js' }] },
    null,
    2,
  ),
);
console.log('ok: host + demo v1/v2');
