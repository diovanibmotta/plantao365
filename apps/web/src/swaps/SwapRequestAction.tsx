import { useState } from 'react';
import type { LocalDate } from '@diovanibmotta/plantao365-shared';
import type { ShiftDto } from '../schedule/types';
import { SwapRequestForm } from './SwapRequestForm';

interface Props {
  shift: ShiftDto;
  today: LocalDate;
}

export function SwapRequestAction({ shift, today }: Props) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  if (shift.date < today) return null;
  if (sent) {
    return (
      <p className="muted" role="status">
        Solicitação enviada. Acompanhe em Trocas.
      </p>
    );
  }
  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Solicitar troca
      </button>
    );
  }
  return (
    <SwapRequestForm
      shift={shift}
      today={today}
      onClose={() => setOpen(false)}
      onDone={() => {
        setOpen(false);
        setSent(true);
      }}
    />
  );
}
