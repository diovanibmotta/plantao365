drop index users_single_master_idx;
alter table users drop column is_master;

update users set role = 'member', active = false where role = 'guest';
alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (role in ('manager', 'member'));
