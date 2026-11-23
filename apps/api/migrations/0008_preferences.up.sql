create function preferences_weekdays_valid(days smallint[]) returns boolean
  language sql immutable as $$
  select days is not null
    and days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
    and cardinality(days) = (select count(distinct d) from unnest(days) as d)
$$;

create table user_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  avoid_weekdays smallint[] not null default '{}'
    constraint user_preferences_weekdays_check check (preferences_weekdays_valid(avoid_weekdays)),
  max_consecutive_shifts smallint
    constraint user_preferences_max_consecutive_check
      check (max_consecutive_shifts is null or (max_consecutive_shifts >= 1 and max_consecutive_shifts <= 14)),
  updated_at timestamptz not null default now()
);
