-- Jornada de trabalho do time: períodos do dia em minutos desde 00:00.
create table work_periods (
  position smallint primary key check (position >= 0),
  start_minute smallint not null check (start_minute between 0 and 1439),
  end_minute smallint not null check (end_minute between 1 and 1440),
  check (end_minute > start_minute),
  updated_at timestamptz not null default now()
);

insert into work_periods (position, start_minute, end_minute)
values (0, 480, 720), (1, 810, 1080);
