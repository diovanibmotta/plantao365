import { useRole } from '../team/TeamContext';
import { UnavailabilityManager } from './UnavailabilityManager';

export function VacationsPage() {
  const role = useRole();
  if (role !== 'manager') {
    return (
      <p className="alert" role="alert">
        Apenas o gestor gerencia férias.
      </p>
    );
  }
  return (
    <UnavailabilityManager
      mode="vacations"
      heading="h1"
      title="Férias"
      newLabel="Novas férias"
      emptyText="Nenhuma férias cadastrada."
    />
  );
}
