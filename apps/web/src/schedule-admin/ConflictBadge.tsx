import type { ScheduleDto } from './types';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Texto dos conflitos da escala; vazio quando não há nenhum. */
export function conflictSummary(conflicts: NonNullable<ScheduleDto['conflicts']>): string {
  const parts: string[] = [];
  if (conflicts.unavailable > 0) {
    parts.push(
      `${plural(conflicts.unavailable, 'plantão', 'plantões')} em dia de férias ou exceção`,
    );
  }
  if (conflicts.outdated > 0) {
    parts.push(
      `${plural(conflicts.outdated, 'plantão', 'plantões')} diferente${conflicts.outdated === 1 ? '' : 's'} de feriados ou horários atuais`,
    );
  }
  return parts.join('; ');
}

/** V verde quando a escala não tem conflito; alerta com o motivo quando tem. */
export function ConflictBadge({ conflicts }: { conflicts: ScheduleDto['conflicts'] }) {
  if (!conflicts) return <span className="muted">—</span>;
  const summary = conflictSummary(conflicts);
  if (!summary) {
    return (
      <span
        className="sad-conflict sad-conflict--ok"
        title="Sem conflitos"
        aria-label="Sem conflitos"
      >
        ✓
      </span>
    );
  }
  return (
    <span
      className="sad-conflict sad-conflict--warn"
      title={summary}
      role="img"
      aria-label={`Conflito: ${summary}`}
    >
      ⚠ Conflito
    </span>
  );
}
