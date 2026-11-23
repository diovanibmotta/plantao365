import type { SqlOrTx } from '../audit/index.js';
import type { Sql } from '../db.js';
import type {
  AdjustmentDto,
  BalanceQuery,
  BalanceTotals,
  MonthBalance,
  ShiftBalanceDetail,
  UserBalance,
} from './types.js';

const round1 = (n: number) => Math.round(n * 10) / 10;

const monthsOf = (year: number) =>
  Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

const yearRange = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` });

interface HoursRow {
  userId: string;
  month: string;
  hours: number;
}

/**
 * Previsto: plantões publicados atribuídos ao responsável original (original_user_id) com as
 * horas originais. Plantões sem original_* (publicados antes da gravação) caem em fallback para
 * o responsável vigente e suas horas. O mês é o da data de início do plantão.
 */
async function plannedRows(sql: SqlOrTx, from: string, to: string, userId?: string) {
  const db = sql as Sql;
  return db<HoursRow[]>`
    select coalesce(s.original_user_id, s.user_id) as "userId",
      to_char(s.date, 'YYYY-MM') as month,
      sum(coalesce(s.original_hours, s.hours))::float8 as hours
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.status = 'published'
      and s.date between ${from}::date and ${to}::date
      and coalesce(s.original_user_id, s.user_id) is not null
      ${userId ? db`and coalesce(s.original_user_id, s.user_id) = ${userId}` : db``}
    group by 1, 2`;
}

/** Realizado de plantões: responsável vigente, plantões publicados já encerrados (ends_at <= now). */
async function doneShiftRows(sql: SqlOrTx, from: string, to: string, now: Date, userId?: string) {
  const db = sql as Sql;
  return db<HoursRow[]>`
    select s.user_id as "userId", to_char(s.date, 'YYYY-MM') as month,
      sum(s.hours)::float8 as hours
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.status = 'published'
      and s.date between ${from}::date and ${to}::date
      and s.user_id is not null
      and s.ends_at <= ${now.toISOString()}::timestamptz
      ${userId ? db`and s.user_id = ${userId}` : db``}
    group by 1, 2`;
}

async function adjustmentRows(sql: SqlOrTx, from: string, to: string, userId?: string) {
  const db = sql as Sql;
  return db<HoursRow[]>`
    select user_id as "userId", to_char(date, 'YYYY-MM') as month, sum(hours)::float8 as hours
    from hour_adjustments
    where date between ${from}::date and ${to}::date
      ${userId ? db`and user_id = ${userId}` : db``}
    group by 1, 2`;
}

export const emptyMonths = (year: number): MonthBalance[] =>
  monthsOf(year).map((month) => ({ month, planned: 0, actual: 0, difference: 0 }));

export function totalsOf(months: MonthBalance[]): BalanceTotals {
  const planned = round1(months.reduce((a, m) => a + m.planned, 0));
  const actual = round1(months.reduce((a, m) => a + m.actual, 0));
  return { planned, actual, difference: round1(actual - planned) };
}

/**
 * Saldo por usuário e mês no ano: previsto, realizado (plantões encerrados + ajustes) e
 * diferença (realizado - previsto). Com `userId`, devolve sempre uma entrada (zerada se vazia);
 * sem ele, só usuários com algum plantão ou ajuste no ano.
 */
export async function computeBalance(sql: SqlOrTx, q: BalanceQuery): Promise<UserBalance[]> {
  const { from, to } = yearRange(q.year);
  const [planned, done, adjustments] = await Promise.all([
    plannedRows(sql, from, to, q.userId),
    doneShiftRows(sql, from, to, q.now, q.userId),
    adjustmentRows(sql, from, to, q.userId),
  ]);

  const byUser = new Map<string, MonthBalance[]>();
  const monthsFor = (userId: string) => {
    let months = byUser.get(userId);
    if (!months) {
      months = emptyMonths(q.year);
      byUser.set(userId, months);
    }
    return months;
  };
  if (q.userId) monthsFor(q.userId);

  const apply = (rows: HoursRow[], field: 'planned' | 'actual') => {
    for (const r of rows) {
      const m = monthsFor(r.userId).find((x) => x.month === r.month);
      if (m) m[field] += r.hours;
    }
  };
  apply(planned, 'planned');
  apply(done, 'actual');
  apply(adjustments, 'actual');

  return [...byUser.entries()].map(([userId, months]) => {
    for (const m of months) {
      m.planned = round1(m.planned);
      m.actual = round1(m.actual);
      m.difference = round1(m.actual - m.planned);
    }
    return { userId, months, ...totalsOf(months) };
  });
}

/** Horas realizadas (plantões encerrados + ajustes) por usuário em [from, to]; histórico da geração. */
export async function listActualHoursByUser(
  sql: SqlOrTx,
  { from, to, now }: { from: string; to: string; now: Date },
): Promise<Map<string, number>> {
  const [done, adjustments] = await Promise.all([
    doneShiftRows(sql, from, to, now),
    adjustmentRows(sql, from, to),
  ]);
  const totals = new Map<string, number>();
  for (const r of [...done, ...adjustments]) {
    totals.set(r.userId, (totals.get(r.userId) ?? 0) + r.hours);
  }
  for (const [id, v] of totals) totals.set(id, round1(v));
  return totals;
}

interface DetailRow {
  date: string;
  dayType: ShiftBalanceDetail['dayType'];
  hours: number;
  originalHours: number | null;
  userId: string | null;
  plannedUserId: string | null;
  done: boolean;
}

/** Detalhe por plantão do ano em que o usuário era o previsto original e/ou é o responsável vigente. */
export async function listShiftDetails(
  sql: SqlOrTx,
  { userId, year, now }: { userId: string; year: number; now: Date },
): Promise<ShiftBalanceDetail[]> {
  const db = sql as Sql;
  const { from, to } = yearRange(year);
  const rows = await db<DetailRow[]>`
    select s.date::text as date, s.day_type as "dayType", s.hours::int as hours,
      s.original_hours::int as "originalHours", s.user_id as "userId",
      coalesce(s.original_user_id, s.user_id) as "plannedUserId",
      s.ends_at <= ${now.toISOString()}::timestamptz as done
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.status = 'published'
      and s.date between ${from}::date and ${to}::date
      and s.ends_at is not null
      and (s.user_id = ${userId} or coalesce(s.original_user_id, s.user_id) = ${userId})
    order by s.date`;
  return rows.map((r) => ({
    date: r.date,
    dayType: r.dayType,
    plannedHours: r.plannedUserId === userId ? (r.originalHours ?? r.hours) : 0,
    actualHours: r.userId === userId && r.done ? r.hours : 0,
    status: r.done ? 'done' : 'upcoming',
    swapped: r.plannedUserId !== r.userId,
  }));
}

const adjustmentColumns = (sql: Sql) => sql`
  id, user_id as "userId", date::text as date, hours::float8 as hours, reason,
  created_by as "createdBy", created_at::text as "createdAt"`;

export async function listAdjustments(
  db: Sql,
  { userId, year }: { userId?: string | undefined; year: number },
): Promise<AdjustmentDto[]> {
  const { from, to } = yearRange(year);
  return db<AdjustmentDto[]>`
    select ${adjustmentColumns(db)} from hour_adjustments
    where date between ${from}::date and ${to}::date
      ${userId ? db`and user_id = ${userId}` : db``}
    order by date, created_at, id`;
}

export async function getAdjustment(db: SqlOrTx, id: string): Promise<AdjustmentDto | null> {
  const sql = db as Sql;
  const [row] = await sql<AdjustmentDto[]>`
    select ${adjustmentColumns(sql)} from hour_adjustments where id = ${id} for update`;
  return row ?? null;
}

export async function insertAdjustment(
  db: SqlOrTx,
  v: { userId: string; date: string; hours: number; reason: string; createdBy: string },
): Promise<AdjustmentDto> {
  const sql = db as Sql;
  const [row] = await sql<AdjustmentDto[]>`
    insert into hour_adjustments (user_id, date, hours, reason, created_by)
    values (${v.userId}, ${v.date}::date, ${v.hours}, ${v.reason}, ${v.createdBy})
    returning ${adjustmentColumns(sql)}`;
  return row!;
}

export async function deleteAdjustment(db: SqlOrTx, id: string): Promise<void> {
  await (db as Sql)`delete from hour_adjustments where id = ${id}`;
}
