delete from shift_weekday_times where weekday not between 1 and 5;
alter table shift_weekday_times drop constraint shift_weekday_times_weekday_check;
alter table shift_weekday_times
  add constraint shift_weekday_times_weekday_check check (weekday between 1 and 5);
