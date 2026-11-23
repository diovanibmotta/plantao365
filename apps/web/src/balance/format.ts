const NUMBER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

const MONTHS_SHORT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

export function formatHours(hours: number): string {
  return `${NUMBER.format(hours)}h`;
}

export function formatSignedHours(hours: number): string {
  if (hours === 0) return '0h';
  return `${hours > 0 ? '+' : '-'}${NUMBER.format(Math.abs(hours))}h`;
}

export function diffClass(hours: number): string {
  if (hours > 0) return 'bal-pos';
  if (hours < 0) return 'bal-neg';
  return '';
}

export function formatMonth(month: string): string {
  const name = MONTHS_SHORT[Number(month.slice(5, 7)) - 1] ?? month;
  return `${name}/${month.slice(0, 4)}`;
}

export function formatDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

export function parseHours(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}
