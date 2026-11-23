import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, TEST_DATABASE_URL, type TestDb } from './test-utils.js';

describe.skipIf(!TEST_DATABASE_URL)('schema users and audit_log', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.drop();
  });

  it('creates users with defaults', async () => {
    const [u] = await t.sql<{ role: string; active: boolean; participates_in_rotation: boolean }[]>`
      insert into users (name, email) values ('Ana', 'ana@example.com')
      returning role, active, participates_in_rotation`;
    expect(u).toEqual({ role: 'member', active: true, participates_in_rotation: true });
  });

  it('rejects duplicate and non-lowercase e-mails and invalid roles', async () => {
    await t.sql`insert into users (name, email) values ('Bia', 'bia@example.com')`;
    await expect(
      t.sql`insert into users (name, email) values ('Bia2', 'bia@example.com')`,
    ).rejects.toThrow();
    await expect(
      t.sql`insert into users (name, email) values ('Caio', 'Caio@Example.com')`,
    ).rejects.toThrow();
    await expect(
      t.sql`insert into users (name, email, role) values ('Dani', 'dani@example.com', 'admin')`,
    ).rejects.toThrow();
  });

  it('audit_log is append-only', async () => {
    await t.sql`insert into audit_log (action, entity_type) values ('create', 'user')`;
    await expect(t.sql`update audit_log set action = 'x'`).rejects.toThrow(/append-only/);
    await expect(t.sql`delete from audit_log`).rejects.toThrow(/append-only/);
    await expect(t.sql`truncate audit_log`).rejects.toThrow(/append-only/);
  });
});
