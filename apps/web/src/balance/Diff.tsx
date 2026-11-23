import { diffClass, formatSignedHours } from './format';

export function Diff({ value }: { value: number }) {
  return <span className={diffClass(value)}>{formatSignedHours(value)}</span>;
}
