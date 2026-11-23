create table unavailabilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  kind text not null check (kind in ('vacation', 'time_off', 'other', 'collective_vacation')),
  start_date date not null,
  end_date date not null,
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unavailabilities_period_check check (end_date >= start_date),
  constraint unavailabilities_collective_check
    check ((kind = 'collective_vacation') = (user_id is null))
);

create index unavailabilities_user_idx on unavailabilities (user_id);
create index unavailabilities_period_idx on unavailabilities (start_date, end_date);
