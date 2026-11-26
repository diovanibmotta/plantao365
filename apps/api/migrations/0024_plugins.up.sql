-- Kernel de plugins: plugins instalados, pacotes assinados e entregas de eventos por plugin.
create table plugins (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{1,39}$'),
  version text not null,
  status text not null default 'installed'
    check (status in ('installed', 'enabled', 'disabled', 'failed')),
  settings jsonb not null default '{}'::jsonb,
  error text,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table plugin_packages (
  plugin_id text not null references plugins (id) on delete cascade,
  version text not null,
  sha256 text not null,
  manifest jsonb not null,
  archive bytea not null,
  signature bytea not null,
  created_at timestamptz not null default now(),
  primary key (plugin_id, version)
);

-- Cada plugin assinante recebe sua cópia do evento: a falha de um não reprocessa os outros.
create table plugin_event_deliveries (
  event_id uuid not null references domain_events (id) on delete cascade,
  plugin_id text not null references plugins (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processed', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  processed_at timestamptz,
  primary key (event_id, plugin_id)
);

create index plugin_event_deliveries_pending_idx
  on plugin_event_deliveries (next_attempt_at)
  where status = 'pending';
