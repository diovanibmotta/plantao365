// Simula o futuro packages/web-sdk: contexto do host consumido pelo plugin.
// Só funciona se host e remote compartilharem a MESMA instância deste módulo e do React.
import { createContext, useContext } from 'react';

export const SdkContext = createContext('sem-host');
export const useSdk = () => useContext(SdkContext);
