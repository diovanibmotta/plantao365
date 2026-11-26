import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import { fileURLToPath } from 'node:url';
import { shared } from '../shared.js';

const version = process.env.PLUGIN_VERSION ?? '1';

// Build do plugin direto no dist do host, como a API serviria /plugins-assets/<id>/<versão>/.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: `/plugins-assets/demo/${version}/`,
  define: { __PLUGIN_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    federation({
      name: 'demo',
      filename: 'remoteEntry.js',
      exposes: { './web': './src/web.jsx' },
      shared,
      dts: false,
    }),
  ],
  build: {
    target: 'esnext',
    outDir: fileURLToPath(new URL(`../host/dist/plugins-assets/demo/${version}`, import.meta.url)),
    emptyOutDir: true,
  },
});
