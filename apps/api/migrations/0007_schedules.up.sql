create table schedules (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by uuid not null references users (id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index schedules_status_idx on schedules (status);
create index schedules_period_idx on schedules (start_date, end_date);

create table shifts (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references schedules (id) on delete cascade,
  date date not null,
  day_type text not null check (day_type in ('weekday', 'weekend', 'holiday', 'collective_vacation')),
  hours smallint not null check (hours in (0, 14, 24)),
  starts_at timestamptz,
  ends_at timestamptz,
  user_id uuid references users (id),
  original_user_id uuid,
  original_hours smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, date)
);

create index shifts_date_idx on shifts (date);
create index shifts_user_id_idx on shifts (user_id);
