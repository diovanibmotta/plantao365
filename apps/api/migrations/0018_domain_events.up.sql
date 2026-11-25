create table domain_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index domain_events_pending_idx on domain_events (next_attempt_at) where status = 'pending';
