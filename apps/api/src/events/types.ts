import type { PublishedEvent, ShiftChange } from '../schedules/index.js';
import type { SwapEvent } from '../swaps/index.js';
import type { ScheduleImpactPayload } from '../schedule-impact/types.js';
import type { UnavailabilityConflictEvent } from '../unavailability/index.js';

/** Alteração de um plantão de escala publicada (edição do gestor ou recálculo por feriado). */
export interface ShiftChangeNotice {
  shiftId: string;
  /** Data local AAAA-MM-DD. */
  date: string;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  hours: number;
  /** Horas antes; só relevante quando o responsável não mudou (recálculo). */
  previousHours?: number | null | undefined;
  previousUserId: string | null;
  newUserId: string | null;
  reason: string | null;
  /** Identifica esta alteração na chave de dedupe; por padrão, o instante da chamada. */
  changeKey?: string | undefined;
}

export interface ScheduleGeneratedPayload {
  scheduleId: string;
  teamId: string;
  startDate: string;
  endDate: string;
  actorId: string;
  shifts: number;
  unassignedDates: number;
}

export interface BalanceAdjustedPayload {
  adjustmentId: string;
  userId: string;
  /** Data local AAAA-MM-DD do ajuste. */
  date: string;
  hours: number;
  reason: string;
  actorId: string;
}

export interface TeamMemberPayload {
  teamId: string;
  userId: string;
  role: 'manager' | 'member';
  participatesInRotation: boolean;
  actorId: string;
}

export interface UserPayload {
  userId: string;
  actorId: string | null;
}

/**
 * Catálogo de eventos de domínio. Cada módulo publica o evento na transação da ação; o consumidor
 * (events/consumer.ts) lê, resolve os destinatários e monta os e-mails.
 */
export interface DomainEventMap {
  'schedule.generated': ScheduleGeneratedPayload;
  'schedule.published': PublishedEvent;
  'shift.changed': ShiftChange;
  'shifts.recalculated': { notices: ShiftChangeNotice[] };
  'swap.requested': SwapEvent;
  'swap.accepted': SwapEvent;
  'swap.declined': SwapEvent;
  'swap.cancelled': SwapEvent;
  'swap.approved': SwapEvent;
  'swap.rejected': SwapEvent;
  'unavailability.conflict': UnavailabilityConflictEvent;
  'schedule.impact': ScheduleImpactPayload;
  'balance.adjusted': BalanceAdjustedPayload;
  'team.member_added': TeamMemberPayload;
  'team.member_updated': TeamMemberPayload;
  'team.member_removed': TeamMemberPayload;
  'user.invited': UserPayload;
  'user.activated': UserPayload;
  'user.deactivated': UserPayload;
}

export type DomainEventType = keyof DomainEventMap;

/** Linha lida pelo consumidor; o payload voltou de JSON (datas viram texto ISO). */
export interface StoredEvent<T extends DomainEventType = DomainEventType> {
  id: string;
  type: T;
  payload: DomainEventMap[T];
  attempts: number;
  createdAt: Date;
}
