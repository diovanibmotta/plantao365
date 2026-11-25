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
  | { source: 'member_exception'; actorId: string; userId: string; start: string; end: string }
  | {
      source: 'collective_vacation';
      actorId: string;
      /** Nulo (férias legadas, sem equipe): vale para todas as equipes. */
      teamId: string | null;
      start: string;
      end: string;
    }
  | { source: 'holiday'; actorId: string; dates: string[] }
  | { source: 'shift_times' | 'shift_exception'; actorId: string; teamId: string };

/** Resultado devolvido à tela (campo `scheduleImpact` da resposta da mutação). */
export interface ScheduleImpact {
  source: ScheduleImpactSource;
  shifts: number;
  dates: string[];
  teams: TeamImpact[];
  /** Texto pt-BR exibido ao usuário (toast). */
  message: string;
}

/** Payload do evento `schedule.impact`, consumido para avisar os gestores por e-mail. */
export interface ScheduleImpactPayload {
  source: ScheduleImpactSource;
  actorId: string;
  /** Membro da exceção (só `member_exception`). */
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
