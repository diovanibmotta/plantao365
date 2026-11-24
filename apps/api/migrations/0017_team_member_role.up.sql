-- Papel (gestor/membro) e participação no rodízio passam a ser configurados por equipe.
-- users.role fica como papel global: 'guest' (sem equipe) ou o maior papel entre as equipes.
alter table team_members
  add column role text not null default 'member' check (role in ('manager', 'member')),
  add column participates_in_rotation boolean not null default true;

update team_members m
set role = case when u.role = 'manager' then 'manager' else 'member' end,
    participates_in_rotation = u.participates_in_rotation
from users u
where u.id = m.user_id;
