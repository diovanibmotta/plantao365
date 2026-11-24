alter table shifts drop constraint shifts_hours_check;
alter table shifts add constraint shifts_hours_check check (hours in (0, 14, 24));
drop table shift_settings;
