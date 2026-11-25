-- Horário por dia da semana passa a cobrir todos os dias (0 = domingo … 6 = sábado).
alter table shift_weekday_times drop constraint shift_weekday_times_weekday_check;
alter table shift_weekday_times
  add constraint shift_weekday_times_weekday_check check (weekday between 0 and 6);
