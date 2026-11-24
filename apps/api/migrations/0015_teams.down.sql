delete from work_periods where team_id <> '00000000-0000-0000-0000-000000000001';
alter table work_periods drop constraint work_periods_pkey;
alter table work_periods drop column team_id;
alter table work_periods add primary key (position);

delete from shift_settings where team_id <> '00000000-0000-0000-0000-000000000001';
alter table shift_settings drop constraint shift_settings_pkey;
alter table shift_settings drop column team_id;
alter table shift_settings add primary key (day_type);

alter table unavailabilities drop column team_id;
alter table schedules drop column team_id;
drop table team_members;
drop table teams;
