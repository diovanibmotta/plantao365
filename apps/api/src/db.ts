import postgres from 'postgres';

export type Sql = postgres.Sql;

export function createDb(url: string, options: { max?: number } = {}): Sql {
  return postgres(url, {
    max: options.max ?? 10,
    onnotice: () => undefined,
  });
}

/** Verifica a conexão com o banco. */
export async function pingDb(sql: Sql): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}
