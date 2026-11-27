import { registerWebSdk } from '@diovanibmotta/plantao365-web-sdk';
import { api } from '../api/client';
import { useActiveTeam, useRole } from '../team/TeamContext';
import { toast } from '../toast/toast-store';

/**
 * Entrega aos plugins os serviços com estado do app. Os componentes visuais já moram no web-sdk;
 * o tipo `WebSdkHost` garante em compilação que o contrato continua compatível.
 */
export function registerPluginSdk(): void {
  registerWebSdk({ api, toast, useActiveTeam, useRole });
}
