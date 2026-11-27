import { registerWebSdk } from '@diovanibmotta/plantao365-web-sdk';
import { api } from '../api/client';
import { useActiveTeam, useRole } from '../team/TeamContext';
import { toast } from '../toast/toast-store';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { FilterBar, normalizeSearch } from '../ui/FilterBar';
import { FormActions, FormPage, FormSection } from '../ui/FormPage';
import { PageHeader } from '../ui/PageHeader';

/**
 * Entrega aos plugins os componentes e serviços das telas nativas. O tipo `WebSdkHost` garante em
 * compilação que o contrato do web-sdk continua compatível com os componentes reais.
 */
export function registerPluginSdk(): void {
  registerWebSdk({
    PageHeader,
    EmptyState,
    FilterBar,
    ConfirmDialog,
    FormPage,
    FormSection,
    FormActions,
    normalizeSearch,
    api,
    toast,
    useActiveTeam,
    useRole,
  });
}
