create table swaps (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('swap', 'cession')),
  status text not null default 'pending'
    check (status in ('pending', 'awaiting_approval', 'approved', 'declined', 'cancelled', 'rejected')),
  requester_id uuid not null references users (id),
  counterpart_id uuid not null references users (id),
  requester_shift_id uuid not null references shifts (id) on delete cascade,
  counterpart_shift_id uuid references shifts (id) on delete cascade,
  note text,
  decision_reason text,
  responded_at timestamptz,
  decided_by uuid references users (id),
  decided_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> counterpart_id),
  check ((kind = 'swap') = (counterpart_shift_id is not null))
);

create index swaps_status_idx on swaps (status);
create index swaps_requester_idx on swaps (requester_id);
create index swaps_counterpart_idx on swaps (counterpart_id);
create unique index swaps_open_requester_shift_uq
  on swaps (requester_shift_id) where status in ('pending', 'awaiting_approval');
create unique index swaps_open_counterpart_shift_uq
  on swaps (counterpart_shift_id) where status in ('pending', 'awaiting_approval');
