alter table users drop constraint users_role_check;
alter table users add constraint users_role_check
  check (role in ('manager', 'member', 'guest'));

alter table users add column is_master boolean not null default false;
create unique index users_single_master_idx on users (is_master) where is_master;
