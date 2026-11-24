-- Horário do plantão por tipo de dia (horas cheias; fim <= início termina no dia seguinte).
create table shift_settings (
  day_type text primary key check (day_type in ('weekday', 'weekend', 'holiday')),
  start_hour smallint not null check (start_hour between 0 and 23),
  end_hour smallint not null check (end_hour between 0 and 23),
  updated_at timestamptz not null default now()
);

insert into shift_settings (day_type, start_hour, end_hour)
values ('weekday', 18, 8), ('weekend', 8, 8), ('holiday', 8, 8);

-- Horas deixam de ser fixas (14/24) e passam a derivar do horário configurado.
alter table shifts drop constraint shifts_hours_check;
alter table shifts add constraint shifts_hours_check check (hours between 0 and 24);
