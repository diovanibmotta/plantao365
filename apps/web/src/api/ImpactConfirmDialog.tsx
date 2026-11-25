import { useSyncExternalStore } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  answerImpactConfirmation,
  getImpactConfirmation,
  subscribeImpactConfirmation,
} from './impact-confirm-store';

const MAX_DATES = 10;
const formatDate = (iso: string) => iso.split('-').reverse().join('/');

/** Modal global: a alteração atinge escala publicada; o usuário escolhe continuar (Sim) ou não. */
export function ImpactConfirmDialog() {
  const req = useSyncExternalStore(subscribeImpactConfirmation, getImpactConfirmation);
  if (!req) return null;
  const shown = req.dates.slice(0, MAX_DATES).map(formatDate);
  if (req.dates.length > shown.length) shown.push(`e mais ${req.dates.length - shown.length}`);
  return (
    <ConfirmDialog
      title="Atenção: escala publicada afetada"
      message={req.message}
      confirmLabel="Sim"
      cancelLabel="Não"
      tone="primary"
      onConfirm={() => answerImpactConfirmation(true)}
      onCancel={() => answerImpactConfirmation(false)}
    >
      {shown.length > 0 && <p>Datas afetadas: {shown.join(', ')}.</p>}
      <p>
        <strong>Deseja continuar?</strong>
      </p>
    </ConfirmDialog>
  );
}
