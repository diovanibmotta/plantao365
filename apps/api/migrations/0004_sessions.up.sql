create table sessions (
  id text primary key,
  user_id uuid not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

create table oidc_login_states (
  state text primary key,
  nonce text not null,
  code_verifier text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index oidc_login_states_expires_at_idx on oidc_login_states (expires_at);
