import { UnavailabilityManager } from './UnavailabilityManager';

export function ExceptionsSection() {
  return (
    <UnavailabilityManager
      mode="member"
      heading="h2"
      title="Exceções"
      newLabel="Nova exceção"
      emptyText="Nenhuma exceção cadastrada."
    />
  );
}
