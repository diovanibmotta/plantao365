import { UnavailabilityForm } from './UnavailabilityForm';

/** Formulário de férias (rotas `/vacations/new` e `/vacations/:id`). */
export function VacationForm() {
  return <UnavailabilityForm mode="vacations" />;
}
