import type { LocalDate } from '@diovanibmotta/plantao365-shared';
import type { Sql } from '../db.js';

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

/** Ponto de extensão (task 9.3): chamado dentro da transação da mutação, antes do commit. */
export interface SwapEvent {
  type: SwapEventType;
  swap: SwapDto;
  actorId: string;
  reason: string | null;
}

/**
 * `sql` é a transação da mutação: o gancho enfileira nela, atomicamente com a mudança de estado.
 * Roda em savepoint: se lançar, só o trabalho do gancho é desfeito e a mutação segue.
 */
export type SwapEventHook = (event: SwapEvent, sql: Sql) => void | Promise<void>;
