import { useState } from 'react';
import { formatDayShort, formatHours } from '../schedule/format';
import { KIND_LABEL, STATUS_LABEL } from './types';
import type { SwapAction, SwapDto, SwapShiftInfo } from './types';
import './swaps.css';

export interface SwapCardProps {
  swap: SwapDto;
  /** Ações disponíveis nesta visão. */
  actions: SwapAction[];
  onAct: (swap: SwapDto, action: SwapAction, reason: string) => Promise<void>;
}

const LABEL: Record<SwapAction, string> = {
  accept: 'Aceitar',
  decline: 'Recusar',
  cancel: 'Cancelar solicitação',
  approve: 'Aprovar',
  reject: 'Rejeitar',
};

const shiftText = (s: SwapShiftInfo) => `${formatDayShort(s.date)} (${formatHours(s.hours)})`;

export function SwapCard({ swap, actions, onAct }: SwapCardProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const managerDecision = actions.includes('approve') || actions.includes('reject');

  const act = async (action: SwapAction) => {
    setBusy(true);
    try {
      await onAct(swap, action, managerDecision ? reason : '');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="swp-card" data-testid="swap-card">
      <div className="swp-card-head">
        <strong>
          {KIND_LABEL[swap.kind]}: {swap.requesterName} → {swap.counterpartName}
        </strong>
        <span className="swp-status">{STATUS_LABEL[swap.status]}</span>
      </div>
      <div>
        {swap.kind === 'swap' && swap.counterpartShift
          ? `${swap.requesterName} cede ${shiftText(swap.requesterShift)}; ${swap.counterpartName} cede ${shiftText(swap.counterpartShift)}`
          : `${swap.requesterName} cede ${shiftText(swap.requesterShift)} a ${swap.counterpartName}`}
      </div>
      {swap.note && <p className="swp-note">Observação: {swap.note}</p>}
      {swap.decisionReason && <p className="swp-note">Motivo: {swap.decisionReason}</p>}
      {managerDecision && (
        <div className="swp-reason">
          <label htmlFor={`reason-${swap.id}`}>Motivo (opcional)</label>
          <input
            id={`reason-${swap.id}`}
            type="text"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      )}
      {actions.length > 0 && (
        <div className="swp-actions">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              className={action === 'accept' || action === 'approve' ? 'btn primary' : 'btn'}
              disabled={busy}
              onClick={() => void act(action)}
            >
              {LABEL[action]}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
