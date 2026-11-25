-- Exceções de horário por data: plantão e jornada diferentes do padrão (ex.: véspera de feriado).
create table shift_exceptions (
  team_id uuid not null references teams (id) on delete cascade,
  date date not null,
  start_hour smallint not null check (start_hour between 0 and 23),
  end_hour smallint not null check (end_hour between 0 and 23),
  work_periods jsonb,
  note text,
  updated_at timestamptz not null default now(),
  primary key (team_id, date)
);
