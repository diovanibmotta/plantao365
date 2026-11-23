create table hour_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  date date not null,
  hours numeric(5, 1) not null check (hours <> 0),
  reason text not null,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now()
);

create index hour_adjustments_user_date_idx on hour_adjustments (user_id, date);
