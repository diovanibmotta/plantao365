import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';

const target = 'http://localhost:3000';

/** Singletons compartilhados com os plugins (remotes carregados em runtime pelo manifesto). */
const shared = {
  react: { singleton: true },
  'react-dom': { singleton: true },
  'react-router': { singleton: true },
  '@plantao365/web-sdk': { singleton: true },
};

export default defineConfig({
  plugins: [react(), federation({ name: 'plantao365', remotes: {}, shared, dts: false })],
  build: { target: 'esnext' },
  server: {
    port: 5173,
    proxy: {
      '/api': { target },
      '/auth': { target },
      '/plugins-assets': { target },
    },
  },
});
