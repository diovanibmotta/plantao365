import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import type { SwapDto, SwapEvent, SwapEventType } from '../swaps/index.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createOnSwapEvent } from './swap-events.js';

const NOW = new Date('2026-03-01T12:00:00Z');
const BASE = 'https://plantao.example';

describe.skipIf(!process.env['TEST_DATABASE_URL'])('notificações de troca (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let ana: string;
  let bia: string;
  let gestor: string;

  const outbox = () =>
    sql<{ to_address: string; subject: string; text: string; dedupe_key: string }[]>`
      select to_address, subject, text, dedupe_key from email_outbox order by to_address, subject`;

  async function user(
    name: string,
    opts: { active?: boolean; role?: 'manager' | 'member' } = {},
  ): Promise<string> {
    const [r] = await sql<{ id: string }[]>`
      insert into users (name, email, active, role)
      values (${name}, ${`${name.toLowerCase()}@example.com`}, ${opts.active ?? true},
        ${opts.role ?? 'member'})
      returning id`;
    return r!.id;
  }

  const swap = (over: Partial<SwapDto> = {}): SwapDto => ({
    id: '22222222-2222-4222-8222-222222222222',
    kind: 'swap',
    status: 'pending',
    requesterId: ana,
    requesterName: 'Ana',
    counterpartId: bia,
    counterpartName: 'Bia',
    requesterShift: {
      id: 's1',
      date: '2026-03-10',
      hours: 12,
      startsAt: '2026-03-10T11:00:00Z',
      endsAt: '2026-03-10T23:00:00Z',
    },
    counterpartShift: {
      id: 's2',
      date: '2026-03-20',
      hours: 14,
      startsAt: null,
      endsAt: null,
    },
    note: null,
    decisionReason: null,
    respondedAt: null,
    decidedBy: null,
    decidedAt: null,
    appliedAt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  });
  const ev = (type: SwapEventType, over: Partial<SwapEvent> = {}): SwapEvent => ({
    type,
    swap: swap(),
    actorId: ana,
    reason: null,
    ...over,
  });
  const hook = () => createOnSwapEvent({ db: sql, appBaseUrl: BASE, now: () => NOW });

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await sql`delete from email_outbox`;
    await sql`delete from users`;
    ana = await user('Ana');
    bia = await user('Bia');
    gestor = await user('Gui', { role: 'manager' });
  });

  it('solicitação: só o colega, com os plantões; sem duplicar', async () => {
    await hook()(ev('requested'));
    await hook()(ev('requested'));
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.to_address).toBe('bia@example.com');
    expect(rows[0]!.subject).toBe('Pedido de troca de plantão: 10/03/2026');
    expect(rows[0]!.text).toContain('das 08:00 às 20:00, 12 h');
    expect(rows[0]!.text).toContain('20 de março de 2026, 14 h');
    expect(rows[0]!.text).toContain(`${BASE}/trocas`);
    expect(rows[0]!.dedupe_key).toBe(`swap-requested:${swap().id}:counterpart`);
  });

  it('aceite: solicitante e gestores ativos, com aviso de aprovação pendente', async () => {
    const inativo = await user('Ines', { active: false, role: 'manager' });
    expect(inativo).toBeTruthy();
    await hook()(ev('accepted', { actorId: bia, swap: swap({ status: 'awaiting_approval' }) }));
    const rows = await outbox();
    expect(rows.map((r) => r.to_address)).toEqual(['ana@example.com', 'gui@example.com']);
    expect(rows.find((r) => r.to_address === 'gui@example.com')!.subject).toBe(
      'Troca aguardando aprovação: 10/03/2026',
    );
    expect(rows.find((r) => r.to_address === 'ana@example.com')!.subject).toBe(
      'Pedido de troca aceito: 10/03/2026',
    );
    expect(gestor).toBeTruthy();
  });

  it('recusa: só o solicitante', async () => {
    await hook()(ev('declined', { actorId: bia }));
    const rows = await outbox();
    expect(rows.map((r) => r.to_address)).toEqual(['ana@example.com']);
    expect(rows[0]!.subject).toBe('Pedido de troca recusado: 10/03/2026');
  });

  it('cancelamento: avisa o colega só se ele recebeu o pedido', async () => {
    await hook()(ev('cancelled'));
    expect(await outbox()).toHaveLength(0);

    await hook()(ev('requested'));
    await hook()(ev('cancelled'));
    const rows = await outbox();
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.subject === 'Pedido de troca cancelado: 10/03/2026')).toBe(true);
  });

  it('aprovação e rejeição: solicitante e colega; rejeição com motivo', async () => {
    await hook()(ev('approved', { actorId: gestor }));
    let rows = await outbox();
    expect(rows.map((r) => r.to_address)).toEqual(['ana@example.com', 'bia@example.com']);
    expect(rows.every((r) => r.subject === 'Troca aprovada: 10/03/2026')).toBe(true);

    await sql`delete from email_outbox`;
    await hook()(ev('rejected', { actorId: gestor, reason: 'Cobertura insuficiente' }));
    rows = await outbox();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.text.includes('Motivo: Cobertura insuficiente'))).toBe(true);
  });

  it('não envia a usuário inativo', async () => {
    await sql`update users set active = false where id = ${bia}`;
    await hook()(ev('requested'));
    await hook()(ev('approved', { actorId: gestor }));
    const rows = await outbox();
    expect(rows.map((r) => r.to_address)).toEqual(['ana@example.com']);
  });

  it('erros são capturados e logados, sem propagar', async () => {
    const errors: unknown[] = [];
    const broken = createOnSwapEvent({
      db: { ...sql, then: undefined } as unknown as Sql,
      logger: { error: (...a: unknown[]) => errors.push(a) } as never,
    });
    await expect(broken(ev('requested'))).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});
