import { useAuth } from '../auth/AuthContext';
import { UnavailabilityManager } from './UnavailabilityManager';

export function CollectiveVacationsPage() {
  const { user } = useAuth();
  if (user?.role !== 'manager') {
    return (
      <p className="alert" role="alert">
        Apenas o gestor gerencia férias coletivas.
      </p>
    );
  }
  return (
    <UnavailabilityManager
      collective
      heading="h1"
      title="Férias coletivas"
      newLabel="Novas férias coletivas"
      emptyText="Nenhuma férias coletiva cadastrada."
    />
  );
}
