-- Equipes: cada equipe tem escala, horários e jornada próprios; usuários podem pertencer a várias.
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now()
);
create unique index teams_name_idx on teams (lower(name));

-- Equipe padrão: recebe os dados anteriores às equipes e é o default das colunas team_id.
insert into teams (id, name) values ('00000000-0000-0000-0000-000000000001', 'Equipe principal');

create table team_members (
  team_id uuid not null references teams (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on team_members (user_id);

insert into team_members (team_id, user_id)
select '00000000-0000-0000-0000-000000000001', id from users where not is_master;

alter table schedules
  add column team_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references teams (id);
create index schedules_team_idx on schedules (team_id);

-- Férias coletivas valem para uma equipe; team_id nulo (legado) vale para todas.
alter table unavailabilities add column team_id uuid references teams (id) on delete cascade;
update unavailabilities set team_id = '00000000-0000-0000-0000-000000000001'
where kind = 'collective_vacation';

alter table shift_settings
  add column team_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references teams (id) on delete cascade;
alter table shift_settings drop constraint shift_settings_pkey;
alter table shift_settings add primary key (team_id, day_type);

alter table work_periods
  add column team_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references teams (id) on delete cascade;
alter table work_periods drop constraint work_periods_pkey;
alter table work_periods add primary key (team_id, position);
