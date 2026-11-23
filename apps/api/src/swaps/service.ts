import type { LocalDate } from '@diovanibmotta/plantao365-shared';
import { recordAudit, type AuditJson, type SqlOrTx } from '../audit/index.js';
import type { Sql } from '../db.js';
import { lockSchedulesThenShifts } from '../schedules/service.js';
import type { SwapDto, SwapEventType, SwapKind, SwapShiftInfo, SwapStatus } from './types.js';

export type Failure = {
  ok: false;
  status: 403 | 404 | 409 | 422;
  error: string;
  message: string;
};
export type Result<T> = { ok: true; value: T } | Failure;

const fail = (status: Failure['status'], error: string, message: string): Failure => ({
  ok: false,
  status,
  error,
  message,
});

/** Mensagem única para exceção do colega: não revela tipo nem detalhe (Req. 10.5). */
export const COUNTERPART_UNAVAILABLE = fail(
  422,
  'counterpart_unavailable',
  'Colega indisponível nessa data',
);

interface SwapRow {
  id: string;
  kind: SwapKind;
  status: SwapStatus;
  requester_id: string;
  requester_name: string;
  counterpart_id: string;
  counterpart_name: string;
  note: string | null;
  decision_reason: string | null;
  responded_at: Date | null;
  decided_by: string | null;
  decided_at: Date | null;
  applied_at: Date | null;
  created_at: Date;
  updated_at: Date;
  rs_id: string;
  rs_date: string;
  rs_hours: number;
  rs_starts: Date | null;
  rs_ends: Date | null;
  cs_id: string | null;
  cs_date: string | null;
  cs_hours: number | null;
  cs_starts: Date | null;
  cs_ends: Date | null;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

function toDto(r: SwapRow): SwapDto {
  const requesterShift: SwapShiftInfo = {
    id: r.rs_id,
    date: r.rs_date as LocalDate,
    hours: r.rs_hours,
    startsAt: iso(r.rs_starts),
    endsAt: iso(r.rs_ends),
  };
  const counterpartShift: SwapShiftInfo | null = r.cs_id
    ? {
        id: r.cs_id,
        date: r.cs_date as LocalDate,
        hours: r.cs_hours!,
        startsAt: iso(r.cs_starts),
        endsAt: iso(r.cs_ends),
      }
    : null;
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    requesterId: r.requester_id,
    requesterName: r.requester_name,
    counterpartId: r.counterpart_id,
    counterpartName: r.counterpart_name,
    requesterShift,
    counterpartShift,
    note: r.note,
    decisionReason: r.decision_reason,
    respondedAt: iso(r.responded_at),
    decidedBy: r.decided_by,
    decidedAt: iso(r.decided_at),
    appliedAt: iso(r.applied_at),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const select = (sql: Sql) => sql`
  select s.id, s.kind, s.status, s.requester_id, ru.name as requester_name,
    s.counterpart_id, cu.name as counterpart_name, s.note, s.decision_reason, s.responded_at,
    s.decided_by, s.decided_at, s.applied_at, s.created_at, s.updated_at,
    rs.id as rs_id, rs.date::text as rs_date, rs.hours as rs_hours,
    rs.starts_at as rs_starts, rs.ends_at as rs_ends,
    cs.id as cs_id, cs.date::text as cs_date, cs.hours as cs_hours,
    cs.starts_at as cs_starts, cs.ends_at as cs_ends
  from swaps s
  join users ru on ru.id = s.requester_id
  join users cu on cu.id = s.counterpart_id
  join shifts rs on rs.id = s.requester_shift_id
  left join shifts cs on cs.id = s.counterpart_shift_id`;

export async function getSwap(db: SqlOrTx, id: string): Promise<SwapDto | null> {
  const sql = db as Sql;
  const [row] = await sql<SwapRow[]>`${select(sql)} where s.id = ${id}`;
  return row ? toDto(row) : null;
}

export async function listSwaps(
  db: Sql,
  filters: { userId?: string | undefined; status?: SwapStatus | undefined },
): Promise<SwapDto[]> {
  const rows = await db<SwapRow[]>`
    ${select(db)}
    where true
      ${filters.userId ? db`and (s.requester_id = ${filters.userId} or s.counterpart_id = ${filters.userId})` : db``}
      ${filters.status ? db`and s.status = ${filters.status}` : db``}
    order by s.created_at desc, s.id`;
  return rows.map(toDto);
}

interface LockedShift {
  id: string;
  date: string;
  hours: number;
  user_id: string | null;
  starts_at: Date | null;
  status: 'draft' | 'published';
}

export interface Feasibility {
  kind: SwapKind;
  requesterId: string;
  counterpartId: string;
  requesterShiftId: string;
  counterpartShiftId: string | null;
  now: Date;
  /** Na criação, o solicitante recebe mensagens específicas sobre os plantões informados. */
  creating: boolean;
}

const startOf = (s: Pick<LockedShift, 'date' | 'starts_at'>) =>
  s.starts_at ?? new Date(`${s.date}T00:00:00Z`);

async function hasException(tx: Sql, userId: string, date: string): Promise<boolean> {
  const rows = await tx`
    select 1 from unavailabilities
    where (user_id = ${userId} or user_id is null)
      and start_date <= ${date}::date and end_date >= ${date}::date
    limit 1`;
  return rows.length > 0;
}

/**
 * Trava escalas e plantões envolvidos (ordem canônica, ver schedules/service.ts) e valida, no momento da chamada:
 * existem, são de escala publicada, pertencem a quem deveriam, têm horas, são futuros
 * (conservador: plantão que já começou é recusado), os envolvidos estão ativos no revezamento
 * e ninguém recebe plantão em data com exceção.
 */
export async function checkFeasibility(
  tx: Sql,
  f: Feasibility,
): Promise<Result<{ requesterShift: LockedShift; counterpartShift: LockedShift | null }>> {
  const ids = [f.requesterShiftId, ...(f.counterpartShiftId ? [f.counterpartShiftId] : [])];
  await lockSchedulesThenShifts(tx, { shiftIds: ids });
  const rows = await tx<LockedShift[]>`
    select sh.id, sh.date::text as date, sh.hours, sh.user_id, sh.starts_at, sc.status
    from shifts sh
    join schedules sc on sc.id = sh.schedule_id
    where sh.id = any(${ids}::uuid[])
    order by sh.id`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const requesterShift = byId.get(f.requesterShiftId);
  const counterpartShift = f.counterpartShiftId ? (byId.get(f.counterpartShiftId) ?? null) : null;

  const gone = fail(422, 'shift_unavailable', 'O plantão não está mais disponível para troca');
  const check = (
    s: LockedShift | undefined | null,
    owner: string,
    mine: boolean,
  ): Failure | null => {
    if (!s || s.status !== 'published' || s.hours <= 0) return gone;
    if (s.user_id !== owner) {
      if (!f.creating) return gone;
      return mine
        ? fail(422, 'shift_not_owned', 'Você só pode trocar plantões seus')
        : fail(422, 'counterpart_shift_not_owned', 'O plantão informado não pertence ao colega');
    }
    if (startOf(s) <= f.now) {
      return fail(422, 'shift_past', 'Plantões que já começaram não podem ser trocados');
    }
    return null;
  };
  const e1 = check(requesterShift, f.requesterId, true);
  if (e1) return e1;
  if (f.kind === 'swap') {
    const e2 = check(counterpartShift, f.counterpartId, false);
    if (e2) return e2;
  }

  const parties = await tx<{ id: string; active: boolean; participates: boolean }[]>`
    select id, active, participates_in_rotation as participates from users
    where id in (${f.requesterId}, ${f.counterpartId})`;
  const cp = parties.find((p) => p.id === f.counterpartId);
  const rq = parties.find((p) => p.id === f.requesterId);
  if (!cp?.active || !cp.participates) {
    return fail(422, 'counterpart_inactive', 'O colega não pode receber plantões');
  }
  if (!rq?.active || !rq.participates) {
    return fail(422, 'requester_inactive', 'O solicitante não pode receber plantões');
  }

  // Exceção do colega na data que ele passaria a cobrir: recusa com mensagem genérica.
  if (await hasException(tx, f.counterpartId, requesterShift!.date)) {
    return COUNTERPART_UNAVAILABLE;
  }
  if (f.kind === 'swap' && (await hasException(tx, f.requesterId, counterpartShift!.date))) {
    return fail(
      422,
      'requester_unavailable',
      'Solicitante indisponível na data do plantão do colega',
    );
  }
  return { ok: true, value: { requesterShift: requesterShift!, counterpartShift } };
}

export interface CreateInput {
  kind: SwapKind;
  requesterId: string;
  counterpartId: string;
  shiftId: string;
  counterpartShiftId: string | null;
  note: string | null;
  now: Date;
}

export async function createSwap(tx: Sql, i: CreateInput): Promise<Result<SwapDto>> {
  if (i.requesterId === i.counterpartId) {
    return fail(422, 'invalid_counterpart', 'Escolha outro membro para a troca');
  }
  const [cp] = await tx`select 1 from users where id = ${i.counterpartId}`;
  if (!cp) return fail(404, 'user_not_found', 'Colega não encontrado');

  const feasible = await checkFeasibility(tx, {
    kind: i.kind,
    requesterId: i.requesterId,
    counterpartId: i.counterpartId,
    requesterShiftId: i.shiftId,
    counterpartShiftId: i.counterpartShiftId,
    now: i.now,
    creating: true,
  });
  if (!feasible.ok) return feasible;

  const ids = [i.shiftId, ...(i.counterpartShiftId ? [i.counterpartShiftId] : [])];
  const open = await tx`
    select 1 from swaps
    where status in ('pending', 'awaiting_approval')
      and (requester_shift_id = any(${ids}::uuid[]) or counterpart_shift_id = any(${ids}::uuid[]))
    limit 1`;
  if (open.length > 0) {
    return fail(409, 'swap_already_open', 'Já existe uma solicitação em andamento para o plantão');
  }

  const [row] = await tx<{ id: string }[]>`
    insert into swaps (kind, requester_id, counterpart_id, requester_shift_id,
      counterpart_shift_id, note)
    values (${i.kind}, ${i.requesterId}, ${i.counterpartId}, ${i.shiftId},
      ${i.counterpartShiftId}, ${i.note})
    returning id`;
  const swap = (await getSwap(tx, row!.id))!;
  await recordAudit(tx, {
    actorId: i.requesterId,
    action: 'swap.create',
    entityType: 'swap',
    entityId: swap.id,
    after: snapshot(swap),
  });
  return { ok: true, value: swap };
}

export type SwapAction = 'accept' | 'decline' | 'cancel' | 'approve' | 'reject';

export interface ActionInput {
  action: SwapAction;
  swapId: string;
  actorId: string;
  actorRole: 'manager' | 'member';
  reason: string | null;
  now: Date;
}

const eventOf: Record<SwapAction, SwapEventType> = {
  accept: 'accepted',
  decline: 'declined',
  cancel: 'cancelled',
  approve: 'approved',
  reject: 'rejected',
};

const nextStatus: Record<SwapAction, SwapStatus> = {
  accept: 'awaiting_approval',
  decline: 'declined',
  cancel: 'cancelled',
  approve: 'approved',
  reject: 'rejected',
};

/** Estado de origem exigido por ação (gestor só decide após o aceite do colega). */
const fromStatuses: Record<SwapAction, SwapStatus[]> = {
  accept: ['pending'],
  decline: ['pending'],
  cancel: ['pending', 'awaiting_approval'],
  approve: ['awaiting_approval'],
  reject: ['awaiting_approval'],
};

export async function transitionSwap(
  tx: Sql,
  i: ActionInput,
): Promise<Result<{ swap: SwapDto; event: SwapEventType }>> {
  const [locked] = await tx<
    {
      kind: SwapKind;
      status: SwapStatus;
      requester_id: string;
      counterpart_id: string;
      requester_shift_id: string;
      counterpart_shift_id: string | null;
    }[]
  >`select kind, status, requester_id, counterpart_id, requester_shift_id, counterpart_shift_id
    from swaps where id = ${i.swapId} for update`;
  const visible =
    locked &&
    (i.actorRole === 'manager' || [locked.requester_id, locked.counterpart_id].includes(i.actorId));
  if (!locked || !visible) return fail(404, 'not_found', 'Solicitação não encontrada');

  let allowed: boolean;
  if (i.action === 'accept' || i.action === 'decline')
    allowed = locked.counterpart_id === i.actorId;
  else if (i.action === 'cancel') allowed = locked.requester_id === i.actorId;
  else allowed = i.actorRole === 'manager';
  if (!allowed) return fail(403, 'forbidden', 'Você não pode executar esta ação na solicitação');
  if (!fromStatuses[i.action].includes(locked.status)) {
    return fail(409, 'invalid_state', 'A solicitação não está em um estado que permita esta ação');
  }

  const before = (await getSwap(tx, i.swapId))!;
  const shiftsChanged: Array<{ id: string; date: string; from: string; to: string }> = [];

  if (i.action === 'accept' || i.action === 'approve') {
    // Revalida na hora: plantões ainda existem/pertencem a quem deveriam, sem exceção/inativo.
    const feasible = await checkFeasibility(tx, {
      kind: locked.kind,
      requesterId: locked.requester_id,
      counterpartId: locked.counterpart_id,
      requesterShiftId: locked.requester_shift_id,
      counterpartShiftId: locked.counterpart_shift_id,
      now: i.now,
      creating: false,
    });
    if (!feasible.ok) return feasible;
    if (i.action === 'approve') {
      const { requesterShift, counterpartShift } = feasible.value;
      const moves = [
        { shift: requesterShift, to: locked.counterpart_id, from: locked.requester_id },
        ...(counterpartShift
          ? [{ shift: counterpartShift, to: locked.requester_id, from: locked.counterpart_id }]
          : []),
      ];
      for (const m of moves) {
        // original_user_id/original_hours permanecem como gravados na publicação.
        await tx`update shifts set user_id = ${m.to}, updated_at = now() where id = ${m.shift.id}`;
        await tx`
          update schedules set updated_at = now()
          where id = (select schedule_id from shifts where id = ${m.shift.id})`;
        shiftsChanged.push({ id: m.shift.id, date: m.shift.date, from: m.from, to: m.to });
      }
    }
  }

  const responded = i.action === 'accept' || i.action === 'decline';
  const decided = i.action === 'approve' || i.action === 'reject';
  await tx`
    update swaps set status = ${nextStatus[i.action]},
      responded_at = ${responded ? tx`now()` : tx`responded_at`},
      decided_by = ${decided ? i.actorId : null},
      decided_at = ${decided ? tx`now()` : tx`null`},
      applied_at = ${i.action === 'approve' ? tx`now()` : tx`null`},
      decision_reason = ${i.reason ?? before.decisionReason},
      updated_at = now()
    where id = ${i.swapId}`;

  const swap = (await getSwap(tx, i.swapId))!;
  for (const c of shiftsChanged) {
    await recordAudit(tx, {
      actorId: i.actorId,
      action: 'schedule.published_shift_change',
      entityType: 'shift',
      entityId: c.id,
      before: { date: c.date, userId: c.from },
      after: { date: c.date, userId: c.to },
      reason: `Troca de plantão aprovada (solicitação ${swap.id})`,
    });
  }
  await recordAudit(tx, {
    actorId: i.actorId,
    action: `swap.${i.action}`,
    entityType: 'swap',
    entityId: swap.id,
    before: snapshot(before),
    after: snapshot(swap),
    reason: i.reason,
  });
  return { ok: true, value: { swap, event: eventOf[i.action] } };
}

const snapshot = (s: SwapDto): AuditJson => JSON.parse(JSON.stringify(s)) as AuditJson;
