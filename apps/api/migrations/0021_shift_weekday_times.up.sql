-- Horário do plantão por dia da semana (1 = segunda … 5 = sexta); sem linha, vale o horário de dia útil.
create table shift_weekday_times (
  team_id uuid not null references teams (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 5),
  start_hour smallint not null check (start_hour between 0 and 23),
  end_hour smallint not null check (end_hour between 0 and 23),
  updated_at timestamptz not null default now(),
  primary key (team_id, weekday)
);
