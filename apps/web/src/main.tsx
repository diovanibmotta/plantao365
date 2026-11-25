import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { ImpactConfirmDialog } from './api/ImpactConfirmDialog';
import { ToastViewport } from './toast/ToastViewport';
import { initTheme } from './theme';
import './styles.css';

initTheme();

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
