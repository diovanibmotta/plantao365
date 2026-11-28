import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { ImpactConfirmDialog } from './api/ImpactConfirmDialog';
import { ToastViewport } from './toast/ToastViewport';
import { initTheme } from './theme';
import { registerPluginSdk } from './plugins/sdk-host';
// CSS do design system: o host carrega uma vez; plugins só consomem (não importam).
import '@plantao365/web-sdk/tokens.css';
import '@plantao365/web-sdk/ui.css';
import './styles.css';

initTheme();
registerPluginSdk();

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <ToastViewport />
        <ImpactConfirmDialog />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
