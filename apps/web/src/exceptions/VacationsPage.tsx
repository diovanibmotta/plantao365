import { useAuth } from '../auth/AuthContext';
import { UnavailabilityManager } from './UnavailabilityManager';

export function VacationsPage() {
  const { user } = useAuth();
  if (user?.role !== 'manager') {
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
