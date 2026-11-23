import type { LocalDate } from '@plantao360/shared';

export const SWAP_KINDS = ['swap', 'cession'] as const;
export type SwapKind = (typeof SWAP_KINDS)[number];

export const SWAP_STATUSES = [
  'pending',
  'awaiting_approval',
  'approved',
  'declined',
  'cancelled',
  'rejected',
] as const;
export type SwapStatus = (typeof SWAP_STATUSES)[number];

export interface SwapShiftInfo {
  id: string;
  date: LocalDate;
  hours: number;
  startsAt: string | null;
  endsAt: string | null;
}

export interface SwapDto {
  id: string;
  kind: SwapKind;
  status: SwapStatus;
  requesterId: string;
  requesterName: string;
  counterpartId: string;
  counterpartName: string;
  /** Plantão do solicitante (sempre presente). */
  requesterShift: SwapShiftInfo;
  /** Plantão do colega (só em permuta). */
  counterpartShift: SwapShiftInfo | null;
  note: string | null;
  decisionReason: string | null;
  respondedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SwapEventType =
  'requested' | 'accepted' | 'declined' | 'cancelled' | 'approved' | 'rejected';

/** Ponto de extensão (task 9.3): chamado após o commit de cada transição. */
export interface SwapEvent {
  type: SwapEventType;
  swap: SwapDto;
  actorId: string;
  reason: string | null;
}

export type SwapEventHook = (event: SwapEvent) => void | Promise<void>;
