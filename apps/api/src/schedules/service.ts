import { parseLocalDate, type LocalDate } from '@plantao360/shared';
import { z } from 'zod';
import type { Sql } from '../db.js';
import type { ScheduleDto, ShiftDto, ShiftRangeQuery } from './types.js';

export const MAX_RANGE_DAYS = 366;

interface ScheduleRow {
  id: string;
  start_date: string;
  end_date: string;
  status: ScheduleDto['status'];
  created_by: string;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ShiftRow {
  id: string;
  schedule_id: string;
  date: string;
  day_type: ShiftDto['dayType'];
  hours: number;
  starts_at: Date | null;
  ends_at: Date | null;
  user_id: string | null;
  user_name: string | null;
  original_user_id: string | null;
  original_hours: number | null;
}

const toScheduleDto = (r: ScheduleRow): ScheduleDto => ({
  id: r.id,
  startDate: r.start_date,
  endDate: r.end_date,
  status: r.status,
  createdBy: r.created_by,
  publishedAt: r.published_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const toShiftDto = (r: ShiftRow): ShiftDto => ({
  id: r.id,
  scheduleId: r.schedule_id,
  date: r.date,
  dayType: r.day_type,
  hours: r.hours,
  startsAt: r.starts_at?.toISOString() ?? null,
  endsAt: r.ends_at?.toISOString() ?? null,
  userId: r.user_id,
  userName: r.user_name,
  originalUserId: r.original_user_id,
  originalHours: r.original_hours,
});

const localDate = z.string().refine(
  (v) => {
    try {
      return parseLocalDate(v) === v;
    } catch {
      return false;
    }
  },
  { message: 'Data inválida; use AAAA-MM-DD' },
);

const daysBetween = (from: LocalDate, to: LocalDate): number =>
  (Date.parse(to) - Date.parse(from)) / 86_400_000;

const rangeChecks = <T extends { from: string; to: string }>(schema: z.ZodType<T>) =>
  schema
    .refine((q) => q.from <= q.to, {
      message: 'from deve ser anterior ou igual a to',
      path: ['from'],
    })
    .refine((q) => daysBetween(q.from, q.to) < MAX_RANGE_DAYS, {
      message: `O intervalo máximo é de ${MAX_RANGE_DAYS} dias`,
      path: ['to'],
    });

export const shiftsQuerySchema = rangeChecks(
  z.object({
    from: localDate,
    to: localDate,
    userId: z.uuid().optional(),
    status: z.enum(['draft', 'published', 'all']).optional(),
  }),
);

export const myShiftsQuerySchema = rangeChecks(z.object({ from: localDate, to: localDate }));

export async function listSchedules(
  sql: Sql,
  opts: { publishedOnly?: boolean } = {},
): Promise<ScheduleDto[]> {
  const rows = await sql<ScheduleRow[]>`
    select id, start_date::text as start_date, end_date::text as end_date, status, created_by,
      published_at, created_at, updated_at
    from schedules
    ${opts.publishedOnly ? sql`where status = 'published'` : sql``}
    order by start_date desc, created_at desc`;
  return rows.map(toScheduleDto);
}

export async function getSchedule(sql: Sql, id: string): Promise<ScheduleDto | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await sql<ScheduleRow[]>`
    select id, start_date::text as start_date, end_date::text as end_date, status, created_by,
      published_at, created_at, updated_at
    from schedules where id = ${id}`;
  return row ? toScheduleDto(row) : null;
}

export async function listShiftsOfSchedule(sql: Sql, scheduleId: string): Promise<ShiftDto[]> {
  const rows = await sql<ShiftRow[]>`
    select s.id, s.schedule_id, s.date::text as date, s.day_type, s.hours, s.starts_at, s.ends_at,
      s.user_id, u.name as user_name, s.original_user_id, s.original_hours
    from shifts s left join users u on u.id = s.user_id
    where s.schedule_id = ${scheduleId}
    order by s.date`;
  return rows.map(toShiftDto);
}

export async function listShiftsInRange(sql: Sql, q: ShiftRangeQuery): Promise<ShiftDto[]> {
  const status = q.status ?? 'published';
  const rows = await sql<ShiftRow[]>`
    select s.id, s.schedule_id, s.date::text as date, s.day_type, s.hours, s.starts_at, s.ends_at,
      s.user_id, u.name as user_name, s.original_user_id, s.original_hours
    from shifts s
    join schedules sc on sc.id = s.schedule_id
    left join users u on u.id = s.user_id
    where s.date between ${q.from}::date and ${q.to}::date
      ${status === 'all' ? sql`` : sql`and sc.status = ${status}`}
      ${q.userId ? sql`and s.user_id = ${q.userId}` : sql``}
    order by s.date, sc.created_at, s.id`;
  return rows.map(toShiftDto);
}

export async function countPublishedShiftsOnDates(
  sql: Sql,
  dates: LocalDate[],
): Promise<Array<{ date: LocalDate; count: number }>> {
  if (dates.length === 0) return [];
  const rows = await sql<{ date: string; count: number }[]>`
    select s.date::text as date, count(*)::int as count
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.status = 'published' and s.date = any(${dates}::date[])
    group by s.date order by s.date`;
  return rows.map((r) => ({ date: r.date, count: r.count }));
}

export async function findPublishedShiftsForUser(
  sql: Sql,
  q: { userId: string | null; start: LocalDate; end: LocalDate },
): Promise<Array<{ date: LocalDate; userId: string | null }>> {
  const rows = await sql<{ date: string; user_id: string | null }[]>`
    select s.date::text as date, s.user_id
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.status = 'published'
      and s.date between ${q.start}::date and ${q.end}::date
      and ${q.userId === null ? sql`s.user_id is null` : sql`s.user_id = ${q.userId}`}
    order by s.date`;
  return rows.map((r) => ({ date: r.date, userId: r.user_id }));
}
