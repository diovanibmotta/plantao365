create table users (
  id uuid primary key default gen_random_uuid(),
  oid text unique,
  name text not null,
  email text not null unique check (email = lower(email)),
  phone text,
  role text not null default 'member' check (role in ('manager', 'member')),
  active boolean not null default true,
  participates_in_rotation boolean not null default true,
  reminders_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text
);

create index audit_log_occurred_at_idx on audit_log (occurred_at desc);
create index audit_log_entity_idx on audit_log (entity_type, entity_id);
create index audit_log_actor_idx on audit_log (actor_id);

create function audit_log_immutable() returns trigger as $$
begin
  raise exception 'audit_log is append-only';
end;
$$ language plpgsql;

create trigger audit_log_no_update_delete
  before update or delete on audit_log
  for each row execute function audit_log_immutable();

create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function audit_log_immutable();
