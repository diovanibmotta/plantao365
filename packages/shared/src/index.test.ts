import { describe, expect, it } from 'vitest';
import { APP_NAME } from './index.js';

describe('shared', () => {
  it('exports the app name', () => {
    expect(APP_NAME).toBe('Plantão360');
  });
});

describe('yearOf', () => {
  it('usa o ano no fuso America/Sao_Paulo', async () => {
    const { yearOf } = await import('./index.js');
    expect(yearOf(new Date('2026-12-31T23:30:00-03:00'))).toBe(2026);
    expect(yearOf(new Date('2027-01-01T02:30:00Z'))).toBe(2026);
    expect(yearOf(new Date('2027-01-01T03:00:00Z'))).toBe(2027);
  });
});
