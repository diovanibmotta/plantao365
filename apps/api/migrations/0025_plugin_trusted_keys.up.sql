-- Chaves públicas que o gestor aceita pela tela, além da chave da loja oficial.
create table plugin_trusted_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  public_key text not null unique,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);
