import { PageTitle } from '../team/PageTitle';
import { useRole } from '../team/TeamContext';
import { UnavailabilityList } from './UnavailabilityList';

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
    <>
      <PageTitle>Férias</PageTitle>
      <UnavailabilityList mode="vacations" />
    </>
  );
}
