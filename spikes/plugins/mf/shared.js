// Dependências compartilhadas como singleton entre host e plugins.
export const shared = {
  react: { singleton: true, requiredVersion: '19.3.1' },
  'react-dom': { singleton: true, requiredVersion: '19.3.1' },
  'react-router': { singleton: true, requiredVersion: '7.18.6' },
  '@spike/web-sdk': { singleton: true, requiredVersion: '1.0.0' },
};
