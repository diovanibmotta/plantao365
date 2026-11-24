-- Foto do Microsoft Entra ID (Graph /me/photo), atualizada a cada login.
alter table users add column photo bytea, add column photo_type text;
