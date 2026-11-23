import { z } from 'zod';
import { parseLocalDate } from '@diovanibmotta/plantao365-shared';
import type { Sql } from '../db.js';

export const HOLIDAY_SCOPES = ['national', 'state', 'municipal'] as const;
export type HolidayScope = (typeof HOLIDAY_SCOPES)[number];

export interface HolidayDto {
  id: string;
  date: string;
  name: string;
  scope: HolidayScope;
}

export interface HolidayWarning {
  type: 'published_shifts_affected';
  date: string;
  count: number;
}

export type ImpactChecker = (
  sql: Sql,
  dates: string[],
) => Promise<Array<{ date: string; count: number }>>;

export const noImpact: ImpactChecker = async () => [];

export const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD')
  .refine((v) => {
    try {
      parseLocalDate(v);
      return true;
    } catch {
      return false;
    }
  }, 'Data inválida');

const holidayName = z.string().trim().min(1, 'Nome obrigatório').max(100, 'Nome muito longo');

export const createHolidaySchema = z.object({
  date: localDate,
  name: holidayName,
  scope: z.enum(HOLIDAY_SCOPES),
});

export const updateHolidaySchema = z
  .object({
    date: localDate.optional(),
    name: holidayName.optional(),
    scope: z.enum(HOLIDAY_SCOPES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Informe ao menos um campo');

export const holidayFiltersSchema = z
  .object({
    year: z.coerce.number().int().min(1900).max(2200).optional(),
    from: localDate.optional(),
    to: localDate.optional(),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, {
    message: 'from deve ser anterior ou igual a to',
    path: ['from'],
  });

export type HolidayFilters = z.infer<typeof holidayFiltersSchema>;

export interface HolidayRow {
  id: string;
  date: string;
  name: string;
  scope: HolidayScope;
}

export const toDto = (r: HolidayRow): HolidayDto => ({
  id: r.id,
  date: r.date,
  name: r.name,
  scope: r.scope,
});

export async function listHolidays(sql: Sql, filters: HolidayFilters = {}): Promise<HolidayDto[]> {
  const year = filters.year === undefined ? null : String(filters.year).padStart(4, '0');
  const from = filters.from ?? (year ? `${year}-01-01` : null);
  const to = filters.to ?? (year ? `${year}-12-31` : null);
  const rows = await sql<HolidayRow[]>`
    select id, date::text as date, name, scope from holidays
    where (${from}::date is null or date >= ${from}::date)
      and (${to}::date is null or date <= ${to}::date)
    order by date, scope`;
  return rows.map(toDto);
}

/** Datas distintas (AAAA-MM-DD) de feriados no intervalo, inclusive, em ordem crescente. */
export async function listHolidayDates(sql: Sql, from: string, to: string): Promise<string[]> {
  const rows = await sql<{ date: string }[]>`
    select distinct date::text as date from holidays
    where date >= ${from}::date and date <= ${to}::date
    order by date`;
  return rows.map((r) => r.date);
}
