import type { Sql } from '../db.js';

/** Pontos de entrada que podem invalidar plantões de escalas já publicadas. */
export const SCHEDULE_IMPACT_SOURCES = [
  'member_exception',
  'collective_vacation',
  'holiday',
  'shift_times',
  'shift_exception',
] as const;

export type ScheduleImpactSource = (typeof SCHEDULE_IMPACT_SOURCES)[number];

/** Plantões publicados afetados de uma equipe (datas AAAA-MM-DD, ordenadas e sem repetição). */
export interface TeamImpact {
  teamId: string;
  dates: string[];
  shifts: number;
}

/** O que mudou; o notificador descobre sozinho se isso atinge escalas publicadas. */
export type ScheduleImpactTrigger =
  | {
      source: 'member_exception';
      actorId: string;
      userId: string;
      start: string;
      end: string;
      removed?: boolean;
    }
  | {
      source: 'collective_vacation';
      actorId: string;
      removed?: boolean;
      /** Nulo (férias legadas, sem equipe): vale para todas as equipes. */
      teamId: string | null;
      start: string;
      end: string;
    }
  | { source: 'holiday'; actorId: string; dates: string[]; removed?: boolean }
  | {
      source: 'shift_times' | 'shift_exception';
      actorId: string;
      teamId: string;
      removed?: boolean;
    };

/** Conflitos de uma escala, de hoje em diante (ambos zero = sem conflito). */
export interface ScheduleConflicts {
  /** Plantões em dia de exceção/férias do responsável ou de férias coletivas. */
  unavailable: number;
  /** Plantões com tipo de dia, horas ou horário diferentes da configuração atual. */
  outdated: number;
}

/** Motivo pelo qual um plantão está em conflito (tela da escala, só gestor). */
export interface ShiftConflict {
  code: 'member_unavailable' | 'collective_vacation' | 'outdated';
  /** Texto pt-BR exibido ao gestor. */
  message: string;
}

/** Resultado devolvido à tela (campo `scheduleImpact` da resposta da mutação). */
export interface ScheduleImpact {
  source: ScheduleImpactSource;
  /** A alteração foi uma exclusão. */
  removed: boolean;
  shifts: number;
  dates: string[];
  teams: TeamImpact[];
  /** Texto pt-BR exibido depois da mudança (toast). */
  message: string;
}

/** Payload do evento `schedule.impact`, consumido para avisar os gestores por e-mail. */
export interface ScheduleImpactPayload {
  source: ScheduleImpactSource;
  actorId: string;
  /** Membro da exceção (só `member_exception`). */
  /** A alteração foi uma exclusão. */
  removed?: boolean;
  userId?: string;
  start?: string;
  end?: string;
  teams: TeamImpact[];
}

/**
 * Regra core: chamado DENTRO da transação da mutação. Se houver plantão publicado afetado,
 * publica o evento (e-mail ao gestor, atômico com a mudança) e devolve o aviso para a tela;
 * sem impacto, devolve `null`.
 */
export type ScheduleImpactNotifier = (
  sql: Sql,
  trigger: ScheduleImpactTrigger,
) => Promise<ScheduleImpact | null>;
