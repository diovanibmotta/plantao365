import type { LocalDate } from '@diovanibmotta/plantao365-shared';

export type SwapKind = 'swap' | 'cession';
export type SwapStatus =
  'pending' | 'awaiting_approval' | 'approved' | 'declined' | 'cancelled' | 'rejected';
export type SwapAction = 'accept' | 'decline' | 'cancel' | 'approve' | 'reject';

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
  requesterShift: SwapShiftInfo;
  counterpartShift: SwapShiftInfo | null;
  note: string | null;
  decisionReason: string | null;
  createdAt: string;
}

export const STATUS_LABEL: Record<SwapStatus, string> = {
  pending: 'Aguardando colega',
  awaiting_approval: 'Aguardando gestor',
  approved: 'Aprovada',
  declined: 'Recusada pelo colega',
  cancelled: 'Cancelada',
  rejected: 'Rejeitada pelo gestor',
};

export const KIND_LABEL: Record<SwapKind, string> = {
  swap: 'Permuta',
  cession: 'Cessão',
};

export const OPEN_STATUSES: readonly SwapStatus[] = ['pending', 'awaiting_approval'];
