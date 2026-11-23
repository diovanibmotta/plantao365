import { UnavailabilityManager } from './UnavailabilityManager';

export function ExceptionsSection() {
  return (
    <UnavailabilityManager
      collective={false}
      heading="h2"
      title="Exceções"
      newLabel="Nova exceção"
      emptyText="Nenhuma exceção cadastrada."
    />
  );
}
