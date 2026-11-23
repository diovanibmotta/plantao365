create table holidays (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  name text not null,
  scope text not null check (scope in ('national', 'state', 'municipal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, scope)
);

insert into holidays (date, name, scope) values
  ('2026-01-01', 'Confraternização Universal', 'national'),
  ('2026-04-03', 'Sexta-feira Santa', 'national'),
  ('2026-04-21', 'Tiradentes', 'national'),
  ('2026-05-01', 'Dia do Trabalho', 'national'),
  ('2026-09-07', 'Independência do Brasil', 'national'),
  ('2026-10-12', 'Nossa Senhora Aparecida', 'national'),
  ('2026-11-02', 'Finados', 'national'),
  ('2026-11-15', 'Proclamação da República', 'national'),
  ('2026-11-20', 'Consciência Negra', 'national'),
  ('2026-12-25', 'Natal', 'national'),
  ('2027-01-01', 'Confraternização Universal', 'national'),
  ('2027-03-26', 'Sexta-feira Santa', 'national'),
  ('2027-04-21', 'Tiradentes', 'national'),
  ('2027-05-01', 'Dia do Trabalho', 'national'),
  ('2027-09-07', 'Independência do Brasil', 'national'),
  ('2027-10-12', 'Nossa Senhora Aparecida', 'national'),
  ('2027-11-02', 'Finados', 'national'),
  ('2027-11-15', 'Proclamação da República', 'national'),
  ('2027-11-20', 'Consciência Negra', 'national'),
  ('2027-12-25', 'Natal', 'national');
