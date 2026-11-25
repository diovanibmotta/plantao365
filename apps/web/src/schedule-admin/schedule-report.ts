import { dayOfWeek } from '@diovanibmotta/plantao365-shared';
import { DAY_TYPE_LABEL, formatPeriod } from '../schedule/format';
import type { ShiftDto } from '../schedule/types';
import type { Team } from '../team/TeamContext';
import { formatDate } from './types';
import type { ScheduleDetail } from './types';

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export const SCHEDULE_STATUS_LABEL = { draft: 'Rascunho', published: 'Publicada' } as const;

/** Dados de cabeçalho do relatório e do CSV. */
export interface ReportContext {
  teamName: string;
  managerName: string;
}

/** Gestor = quem gerou a escala; sem o nome dele na equipe, os gestores da equipe ativa. */
export function reportContext(
  schedule: ScheduleDetail,
  names: Map<string, string>,
  team: Team | null,
): ReportContext {
  const creator = schedule.createdBy ? names.get(schedule.createdBy) : undefined;
  return {
    teamName: team?.name ?? '',
    managerName: creator ?? team?.managers?.join(', ') ?? '',
  };
}

const isVacation = (s: ShiftDto) => s.dayType === 'collective_vacation';

export interface MemberTotal {
  name: string;
  /** Matrícula/crachá (opcional no cadastro). */
  badge: string | null;
  shifts: number;
  weekendHolidayShifts: number;
  hours: number;
}

/** Totais por membro com plantão (férias coletivas e dias sem responsável ficam de fora). */
export function memberTotals(shifts: readonly ShiftDto[]): MemberTotal[] {
  const totals = new Map<string, MemberTotal>();
  for (const s of shifts) {
    if (isVacation(s) || !s.userId) continue;
    const t = totals.get(s.userId) ?? {
      name: s.userName ?? 'Membro',
      badge: s.userBadgeNumber ?? null,
      shifts: 0,
      weekendHolidayShifts: 0,
      hours: 0,
    };
    t.shifts += 1;
    t.hours += s.hours;
    if (s.dayType !== 'weekday') t.weekendHolidayShifts += 1;
    totals.set(s.userId, t);
  }
  return [...totals.values()].sort(
    (a, b) => b.hours - a.hours || a.name.localeCompare(b.name, 'pt-BR'),
  );
}

/** Dias que exigem plantão e quantos têm responsável. */
export function coverage(shifts: readonly ShiftDto[]): { covered: number; total: number } {
  const days = shifts.filter((s) => !isVacation(s));
  return { covered: days.filter((s) => s.userId).length, total: days.length };
}

export const weekdayOf = (s: ShiftDto) => WEEKDAYS[dayOfWeek(s.date)] ?? '';

export const dayLabel = (s: ShiftDto) =>
  s.dayType === 'weekday' ? weekdayOf(s) : `${weekdayOf(s)} · ${DAY_TYPE_LABEL[s.dayType]}`;

export const memberLabel = (s: ShiftDto) =>
  isVacation(s) ? 'Férias coletivas' : (s.userName ?? 'Sem responsável');

/** Início e fim (HH:MM) do plantão; vazio em férias coletivas. */
function times(s: ShiftDto): [string, string] {
  if (isVacation(s)) return ['', ''];
  const [start = '', end = ''] = formatPeriod(s).split('–');
  return [start, end];
}

export type CsvFieldKey =
  | 'date'
  | 'weekday'
  | 'dayType'
  | 'member'
  | 'badge'
  | 'start'
  | 'end'
  | 'hours'
  | 'team'
  | 'status';

export interface CsvField {
  key: CsvFieldKey;
  label: string;
  value: (s: ShiftDto, schedule: ScheduleDetail, ctx: ReportContext) => string;
}

/** Ordem padrão das colunas; `DEFAULT_CSV_KEYS` diz quais vêm marcadas. */
export const CSV_FIELDS: readonly CsvField[] = [
  { key: 'date', label: 'Data', value: (s) => formatDate(s.date) },
  { key: 'weekday', label: 'Dia da semana', value: weekdayOf },
  { key: 'dayType', label: 'Tipo do dia', value: (s) => DAY_TYPE_LABEL[s.dayType] },
  { key: 'member', label: 'Responsável', value: memberLabel },
  { key: 'badge', label: 'Matrícula', value: (s) => s.userBadgeNumber ?? '' },
  { key: 'start', label: 'Início', value: (s) => times(s)[0] },
  { key: 'end', label: 'Fim', value: (s) => times(s)[1] },
  { key: 'hours', label: 'Horas', value: (s) => (isVacation(s) ? '' : String(s.hours)) },
  { key: 'team', label: 'Equipe', value: (_s, _schedule, ctx) => ctx.teamName },
  {
    key: 'status',
    label: 'Status da escala',
    value: (_s, schedule) => SCHEDULE_STATUS_LABEL[schedule.status],
  },
];

export const DEFAULT_CSV_KEYS: readonly CsvFieldKey[] = [
  'date',
  'weekday',
  'dayType',
  'member',
  'start',
  'end',
  'hours',
];

/** Campos na ordem de `keys` (chaves desconhecidas são ignoradas). */
export const csvFields = (keys: readonly CsvFieldKey[]): CsvField[] =>
  keys
    .map((k) => CSV_FIELDS.find((f) => f.key === k))
    .filter((f): f is CsvField => f !== undefined);

const BOM = String.fromCharCode(0xfeff);

const csvCell = (v: string) => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV com `;` e BOM UTF-8 (abre direto no Excel em pt-BR), colunas na ordem de `keys`. */
export function buildCsv(
  schedule: ScheduleDetail,
  keys: readonly CsvFieldKey[],
  ctx: ReportContext,
): string {
  const fields = csvFields(keys);
  const lines = [
    fields.map((f) => csvCell(f.label)).join(';'),
    ...schedule.shifts.map((s) => fields.map((f) => csvCell(f.value(s, schedule, ctx))).join(';')),
  ];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

const slug = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Ex.: escala-infraestrutura-2026-12-15_2026-12-28.pdf */
export function reportFileName(schedule: ScheduleDetail, ctx: ReportContext, ext: string): string {
  const team = slug(ctx.teamName);
  return `escala-${team ? `${team}-` : ''}${schedule.startDate}_${schedule.endDate}.${ext}`;
}

/** Dispara o download de um arquivo gerado no navegador. */
export function downloadFile(content: Blob, fileName: string): void {
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
