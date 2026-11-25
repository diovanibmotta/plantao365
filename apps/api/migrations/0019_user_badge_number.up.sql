alter table users add column badge_number text check (badge_number is null or char_length(badge_number) <= 30);
