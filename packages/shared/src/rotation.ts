/**
 * Motor de rodízio (puro e determinístico, sem relógio nem aleatoriedade).
 *
 * Heurística gulosa em duas fases:
 * 0. Antes de gerar, aplica férias coletivas e exceções/férias dos membros: cada dia fica com
 *    seus elegíveis. Depois atribui os dias mais restritos primeiro (menos elegíveis, depois
 *    data), para que o plantão forçado por férias dos outros entre na conta de quem o assume
 *    antes da divisão do resto. Sem exceções, a ordem é a cronológica.
 * 1. Elegível = ativo, participa do rodízio e sem exceção na data (regra rígida, nunca violada).
 *    Férias coletivas: 0h, sem responsável, não conta como "sem elegível".
 * 2. Disponibilidade = dias do período (fora férias coletivas) sem exceção; 0 vira 1 na divisão.
 * 3. Pontuação do candidato (menor vence) = carga de horas após assumir o dia
 *    ((histórico + alocado no período + horas do dia) / disponibilidade) e, em fim de semana
 *    ou feriado, somada à carga de plantões de 24h (histórico + alocados) na mesma normalização.
 *    A normalização cobre membro novo ou voltando de exceção longa: poucos dias disponíveis
 *    elevam rápido a carga por plantão, então ele não absorve a compensação inteira.
 * 4. Preferências brandas somam penalidade equivalente a PREFERENCE_PENALTY_SHIFTS plantões
 *    do próprio membro (atendidas se o equilíbrio permitir); violações são reportadas.
 * 5. Empate (tolerância numérica) decidido por id, e a ordem dos membros no input é irrelevante.
 */
import { type LocalDate, addDays, dateRange, dayOfWeek } from './dates.js';
import { type DayType, type ShiftContext, classifyDay, shiftHoursFor } from './shifts.js';

/** Quantos plantões "à frente" no equilíbrio uma violação de preferência pode custar. */
const PREFERENCE_PENALTY_SHIFTS = 2;
const EPSILON = 1e-9;

export interface RotationMemberPreferences {
  /** 0 = domingo ... 6 = sábado. */
  avoidWeekdays: readonly number[];
  maxConsecutiveShifts: number | null;
}

export interface RotationMember {
  id: string;
  name?: string;
  active: boolean;
  participatesInRotation: boolean;
  /** Exceções individuais (datas em que o membro não pode ser escalado). */
  unavailableDates: readonly LocalDate[];
  preferences: RotationMemberPreferences;
  /** Acumulado realizado das escalas publicadas. */
  history: { hoursDone: number; weekendHolidayShiftsDone: number };
}

export interface RotationInput {
  from: LocalDate;
  to: LocalDate;
  shiftContext: ShiftContext;
  members: readonly RotationMember[];
  /** Plantões imediatamente anteriores ao período, para contar consecutivos. */
  lastAssignments?: readonly { date: LocalDate; userId: string }[];
}

export interface RotationShift {
  date: LocalDate;
  userId: string | null;
  dayType: DayType;
  hours: number;
}

export type PreferenceViolationKind = 'avoid_weekday' | 'max_consecutive';

export interface PreferenceViolation {
  date: LocalDate;
  userId: string;
  kind: PreferenceViolationKind;
}

export interface RotationMemberSummary {
  userId: string;
  /** Horas alocadas no período. */
  hours: number;
  /** Plantões de fim de semana/feriado alocados no período. */
  weekendHolidayShifts: number;
  /** Total de plantões alocados no período. */
  shifts: number;
}

export interface RotationOutput {
  shifts: RotationShift[];
  /** Dias aplicáveis (fora férias coletivas) sem membro elegível. */
  unassignedDates: LocalDate[];
  preferenceViolations: PreferenceViolation[];
  summary: RotationMemberSummary[];
}

interface MemberState {
  member: RotationMember;
  unavailable: ReadonlySet<LocalDate>;
  avoid: ReadonlySet<number>;
  availableDays: number;
  hours: number;
  specialShifts: number;
}

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Plantões seguidos do membro colados à data, antes e depois (a atribuição não é cronológica). */
function consecutiveRun(
  assigned: ReadonlyMap<LocalDate, string>,
  userId: string,
  date: LocalDate,
): number {
  let run = 0;
  for (let d = addDays(date, -1); assigned.get(d) === userId; d = addDays(d, -1)) run += 1;
  for (let d = addDays(date, 1); assigned.get(d) === userId; d = addDays(d, 1)) run += 1;
  return run;
}

export function generateRotation(input: RotationInput): RotationOutput {
  const holidays = new Set(input.shiftContext.holidays);
  const ctx: ShiftContext = { ...input.shiftContext, holidays };
  const days = dateRange(input.from, input.to).map((date) => ({
    date,
    dayType: classifyDay(date, ctx),
  }));

  const states: MemberState[] = [...input.members].sort(byId).map((member) => {
    const unavailable = new Set(member.unavailableDates);
    const eligibleMember = member.active && member.participatesInRotation;
    const availableDays = eligibleMember
      ? days.filter((d) => d.dayType !== 'collective_vacation' && !unavailable.has(d.date)).length
      : 0;
    return {
      member,
      unavailable,
      avoid: new Set(member.preferences.avoidWeekdays),
      availableDays,
      hours: 0,
      specialShifts: 0,
    };
  });

  const assigned = new Map<LocalDate, string>();
  for (const last of input.lastAssignments ?? []) assigned.set(last.date, last.userId);

  // Fase 1: férias coletivas e exceções/férias dos membros definem os elegíveis de cada dia.
  const plan = days.map(({ date, dayType }) => ({
    date,
    dayType,
    hours: shiftHoursFor(date, dayType, ctx),
    candidates:
      dayType === 'collective_vacation'
        ? []
        : states.filter(
            (s) => s.member.active && s.member.participatesInRotation && !s.unavailable.has(date),
          ),
  }));

  // Fase 2: dias mais restritos primeiro; empate pela data (sort estável sobre a ordem cronológica).
  const order = plan
    .filter((d) => d.candidates.length > 0)
    .sort((a, b) => a.candidates.length - b.candidates.length);
  const chosen = new Map<LocalDate, string>();
  const preferenceViolations: PreferenceViolation[] = [];

  for (const { date, dayType, hours, candidates } of order) {
    const special = dayType !== 'weekday';
    const dow = dayOfWeek(date);

    let best: { state: MemberState; score: number; avoid: boolean; consecutive: boolean } | null =
      null;
    for (const state of candidates) {
      const { member } = state;
      const avail = Math.max(state.availableDays, 1);
      const hoursBefore = (member.history.hoursDone + state.hours) / avail;
      const hoursAfter = (member.history.hoursDone + state.hours + hours) / avail;
      let before = hoursBefore;
      let after = hoursAfter;
      if (special) {
        const specialBefore =
          ((member.history.weekendHolidayShiftsDone + state.specialShifts) * 24) / avail;
        before += specialBefore;
        after += ((member.history.weekendHolidayShiftsDone + state.specialShifts + 1) * 24) / avail;
      }
      const avoid = state.avoid.has(dow);
      const max = member.preferences.maxConsecutiveShifts;
      const consecutive = max !== null && consecutiveRun(assigned, member.id, date) + 1 > max;
      const penalty =
        (avoid ? 1 : 0) + (consecutive ? 1 : 0) > 0
          ? PREFERENCE_PENALTY_SHIFTS * (after - before) * ((avoid ? 1 : 0) + (consecutive ? 1 : 0))
          : 0;
      const score = after + penalty;
      if (best === null || score < best.score - EPSILON)
        best = { state, score, avoid, consecutive };
    }

    if (best === null) continue; // não ocorre: o dia tem ao menos um elegível
    const { state } = best;
    state.hours += hours;
    if (special) state.specialShifts += 1;
    assigned.set(date, state.member.id);
    chosen.set(date, state.member.id);
    if (best.avoid)
      preferenceViolations.push({ date, userId: state.member.id, kind: 'avoid_weekday' });
    if (best.consecutive) {
      preferenceViolations.push({ date, userId: state.member.id, kind: 'max_consecutive' });
    }
  }
  preferenceViolations.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const shifts: RotationShift[] = plan.map(({ date, dayType, hours }) => ({
    date,
    userId: chosen.get(date) ?? null,
    dayType,
    hours,
  }));
  const unassignedDates = plan
    .filter((d) => d.dayType !== 'collective_vacation' && d.candidates.length === 0)
    .map((d) => d.date);

  const summary = states.map((s) => ({
    userId: s.member.id,
    hours: s.hours,
    weekendHolidayShifts: s.specialShifts,
    shifts: shifts.filter((sh) => sh.userId === s.member.id).length,
  }));

  return { shifts, unassignedDates, preferenceViolations, summary };
}
