import type { ScheduleImpact, ScheduleImpactSource, TeamImpact } from './types.js';

const plural = (n: number) => (n === 1 ? '1 plantão publicado' : `${n} plantões publicados`);

const BY_SOURCE: Record<ScheduleImpactSource, (n: number) => string> = {
  member_exception: (n) => `${plural(n)} em conflito com esta exceção de disponibilidade.`,
  collective_vacation: (n) => `${plural(n)} no período destas férias coletivas.`,
  holiday: (n) => `${plural(n)} em datas afetadas por este feriado.`,
  shift_times: (n) => `${plural(n)} com horário diferente do novo horário configurado.`,
  shift_exception: (n) => `${plural(n)} com horário diferente desta exceção de horário.`,
};

const BY_SOURCE_REMOVED: Record<ScheduleImpactSource, (n: number) => string> = {
  member_exception: (n) => `${plural(n)} no período desta exceção de disponibilidade.`,
  collective_vacation: (n) => `${plural(n)} no período destas férias coletivas.`,
  holiday: (n) => `${plural(n)} em datas afetadas por este feriado.`,
  shift_times: (n) =>
    `${plural(n)} com horário diferente do horário configurado depois da exclusão.`,
  shift_exception: (n) => `${plural(n)} com horário diferente depois da exclusão desta exceção.`,
};

const summary = (source: ScheduleImpactSource, shifts: number, removed: boolean) =>
  (removed ? BY_SOURCE_REMOVED : BY_SOURCE)[source](shifts);

/** Texto do aviso em tela (toast) depois que a alteração foi salva. */
export function impactMessage(
  source: ScheduleImpactSource,
  shifts: number,
  removed = false,
): string {
  return `${summary(source, shifts, removed)} Recalcule ou ajuste a escala; os gestores da equipe foram avisados por e-mail.`;
}

/** Texto da confirmação exibida ANTES de salvar (o usuário escolhe continuar ou não). */
export function impactConfirmMessage(
  source: ScheduleImpactSource,
  shifts: number,
  removed = false,
): string {
  return `${summary(source, shifts, removed)} Ao continuar, os gestores da equipe serão avisados por e-mail para recalcular ou ajustar a escala.`;
}

/** Une os avisos de várias linhas criadas de uma vez (ex.: férias coletivas de vários membros). */
export function mergeScheduleImpacts(list: ScheduleImpact[]): ScheduleImpact | null {
  const first = list[0];
  if (!first) return null;
  const byTeam = new Map<string, TeamImpact>();
  for (const impact of list) {
    for (const t of impact.teams) {
      const cur = byTeam.get(t.teamId);
      byTeam.set(
        t.teamId,
        cur
          ? {
              teamId: t.teamId,
              dates: [...new Set([...cur.dates, ...t.dates])].sort(),
              shifts: cur.shifts + t.shifts,
            }
          : { ...t },
      );
    }
  }
  const teams = [...byTeam.values()].sort((a, b) => a.teamId.localeCompare(b.teamId));
  const shifts = teams.reduce((sum, t) => sum + t.shifts, 0);
  return {
    source: first.source,
    removed: first.removed,
    shifts,
    dates: [...new Set(teams.flatMap((t) => t.dates))].sort(),
    teams,
    message: impactMessage(first.source, shifts, first.removed),
  };
}
