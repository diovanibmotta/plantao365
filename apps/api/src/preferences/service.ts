import type { SqlOrTx } from '../audit/index.js';
import type { Sql } from '../db.js';
import { emptyPreferences, type PreferencesDto } from './types.js';

interface Row {
  userId: string;
  avoidWeekdays: number[];
  maxConsecutiveShifts: number | null;
}

const toDto = (row: Row): PreferencesDto => ({
  avoidWeekdays: [...row.avoidWeekdays].sort((a, b) => a - b),
  maxConsecutiveShifts: row.maxConsecutiveShifts,
});

export async function getPreferences(
  db: SqlOrTx,
  userId: string,
  forUpdate = false,
): Promise<PreferencesDto> {
  const sql = db as Sql;
  const [row] = await sql<Row[]>`
    select user_id as "userId", avoid_weekdays as "avoidWeekdays",
      max_consecutive_shifts as "maxConsecutiveShifts"
    from user_preferences where user_id = ${userId}
    ${forUpdate ? sql`for update` : sql``}`;
  return row ? toDto(row) : emptyPreferences();
}

export async function upsertPreferences(
  db: SqlOrTx,
  userId: string,
  value: PreferencesDto,
): Promise<PreferencesDto> {
  const sql = db as Sql;
  const days = [...value.avoidWeekdays].sort((a, b) => a - b);
  const [row] = await sql<Row[]>`
    insert into user_preferences (user_id, avoid_weekdays, max_consecutive_shifts)
    values (${userId}, ${days}::smallint[], ${value.maxConsecutiveShifts})
    on conflict (user_id) do update
      set avoid_weekdays = excluded.avoid_weekdays,
        max_consecutive_shifts = excluded.max_consecutive_shifts,
        updated_at = now()
    returning user_id as "userId", avoid_weekdays as "avoidWeekdays",
      max_consecutive_shifts as "maxConsecutiveShifts"`;
  return toDto(row!);
}

/**
 * Preferências brandas para a geração de escala (sem HTTP). Usuários de `userIds` sem linha
 * recebem o padrão vazio; sem `userIds`, devolve apenas quem tem preferências gravadas.
 */
export async function listPreferences(
  sql: Sql,
  userIds?: string[],
): Promise<Map<string, PreferencesDto>> {
  const rows =
    userIds && userIds.length === 0
      ? []
      : await sql<Row[]>`
          select user_id as "userId", avoid_weekdays as "avoidWeekdays",
            max_consecutive_shifts as "maxConsecutiveShifts"
          from user_preferences
          ${userIds ? sql`where user_id in ${sql(userIds)}` : sql``}
          order by user_id`;
  const result = new Map<string, PreferencesDto>();
  for (const id of userIds ?? []) result.set(id, emptyPreferences());
  for (const row of rows) result.set(row.userId, toDto(row));
  return result;
}
