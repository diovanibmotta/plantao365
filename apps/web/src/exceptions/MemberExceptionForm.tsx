import { UnavailabilityForm } from './UnavailabilityForm';

/** Formulário das exceções do próprio membro (rotas `/profile/exceptions/new` e `/:id`). */
export function MemberExceptionForm() {
  return <UnavailabilityForm mode="member" />;
}
