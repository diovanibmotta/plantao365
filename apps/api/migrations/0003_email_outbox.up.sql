create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_address text not null,
  subject text not null,
  html text not null,
  text text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index email_outbox_pending_idx on email_outbox (next_attempt_at) where status = 'pending';
