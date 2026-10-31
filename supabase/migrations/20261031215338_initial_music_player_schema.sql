-- MUSIC PLAYER: esquema inicial. Aplicado en el proyecto remoto el 2026-10-31.
-- Las tablas privadas solo son accesibles por la Edge Function (service_role/secret key).

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  email text not null,
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_username_format check (username = lower(username) and username ~ '^[a-z0-9_]{3,30}$'),
  constraint users_email_format check (email = lower(email) and length(email) between 5 and 254)
);
create unique index if not exists users_username_uidx on public.users(username);
create unique index if not exists users_email_uidx on public.users(email);

create table if not exists public.user_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  display_name text not null default '',
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_display_name_length check (length(display_name) <= 80)
);

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists user_sessions_user_active_idx on public.user_sessions(user_id, expires_at desc) where revoked_at is null;
create index if not exists user_sessions_expiry_idx on public.user_sessions(expires_at);

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  artist text not null default '',
  album text not null default '',
  genre text not null default '',
  duration_seconds integer,
  source_type text not null default 'local',
  audio_path text,
  cover_path text,
  mime_type text,
  file_size_bytes bigint,
  original_file_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint songs_title_length check (length(title) between 1 and 250),
  constraint songs_artist_length check (length(artist) <= 250),
  constraint songs_album_length check (length(album) <= 250),
  constraint songs_genre_length check (length(genre) <= 100),
  constraint songs_duration_nonnegative check (duration_seconds is null or duration_seconds >= 0),
  constraint songs_source_type check (source_type in ('local','storage')),
  constraint songs_storage_path_required check ((source_type = 'local' and audio_path is null) or (source_type = 'storage' and audio_path is not null)),
  constraint songs_file_size_nonnegative check (file_size_bytes is null or file_size_bytes >= 0),
  constraint songs_id_user_unique unique (id, user_id)
);
create index if not exists songs_user_created_idx on public.songs(user_id, created_at desc);
create index if not exists songs_user_artist_idx on public.songs(user_id, artist);
create index if not exists songs_user_title_idx on public.songs(user_id, title);

create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint playlists_name_length check (length(name) between 1 and 100),
  constraint playlists_description_length check (length(description) <= 500),
  constraint playlists_id_user_unique unique (id, user_id)
);
create index if not exists playlists_user_updated_idx on public.playlists(user_id, updated_at desc);

create table if not exists public.playlist_songs (
  playlist_id uuid not null,
  song_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  position integer not null default 0,
  added_at timestamptz not null default now(),
  primary key (playlist_id, song_id),
  constraint playlist_songs_position_nonnegative check (position >= 0),
  constraint playlist_songs_playlist_owner_fk foreign key (playlist_id, user_id) references public.playlists(id, user_id) on delete cascade,
  constraint playlist_songs_song_owner_fk foreign key (song_id, user_id) references public.songs(id, user_id) on delete cascade
);
create index if not exists playlist_songs_order_idx on public.playlist_songs(playlist_id, position);

create table if not exists public.favorites (
  user_id uuid not null references public.users(id) on delete cascade,
  song_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, song_id),
  constraint favorites_song_owner_fk foreign key (song_id, user_id) references public.songs(id, user_id) on delete cascade
);
create index if not exists favorites_user_created_idx on public.favorites(user_id, created_at desc);

create table if not exists public.listening_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  song_id uuid references public.songs(id) on delete set null,
  snapshot_title text not null,
  snapshot_artist text not null default '',
  played_at timestamptz not null default now(),
  listened_seconds integer not null default 0,
  completed boolean not null default false,
  constraint history_listened_nonnegative check (listened_seconds >= 0),
  constraint history_title_length check (length(snapshot_title) between 1 and 250)
);
create index if not exists history_user_played_idx on public.listening_history(user_id, played_at desc);

create table if not exists public.user_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  theme text not null default 'dark',
  volume numeric(4,3) not null default 0.8,
  playback_speed numeric(3,2) not null default 1.0,
  repeat_mode text not null default 'off',
  shuffle boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_theme check (theme in ('dark','light','system')),
  constraint user_settings_volume check (volume between 0 and 1),
  constraint user_settings_speed check (playback_speed between 0.5 and 2.0),
  constraint user_settings_repeat check (repeat_mode in ('off','one','all'))
);

create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  identifier_hash text not null,
  succeeded boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_identifier_time_idx on public.login_attempts(identifier_hash, created_at desc) where succeeded = false;

create table if not exists public.password_recovery_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists recovery_user_expiry_idx on public.password_recovery_tokens(user_id, expires_at desc);

-- Actualización automática de marcas de tiempo.
drop trigger if exists users_touch_updated_at on public.users;
create trigger users_touch_updated_at before update on public.users for each row execute function private.touch_updated_at();
drop trigger if exists profiles_touch_updated_at on public.user_profiles;
create trigger profiles_touch_updated_at before update on public.user_profiles for each row execute function private.touch_updated_at();
drop trigger if exists songs_touch_updated_at on public.songs;
create trigger songs_touch_updated_at before update on public.songs for each row execute function private.touch_updated_at();
drop trigger if exists playlists_touch_updated_at on public.playlists;
create trigger playlists_touch_updated_at before update on public.playlists for each row execute function private.touch_updated_at();
drop trigger if exists settings_touch_updated_at on public.user_settings;
create trigger settings_touch_updated_at before update on public.user_settings for each row execute function private.touch_updated_at();

-- Sin políticas anon/authenticated: el acceso es exclusivamente desde Edge Functions,
-- que validan sus propias sesiones antes de usar la clave secreta del servidor.
alter table public.users enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_sessions enable row level security;
alter table public.songs enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_songs enable row level security;
alter table public.favorites enable row level security;
alter table public.listening_history enable row level security;
alter table public.user_settings enable row level security;
alter table public.login_attempts enable row level security;
alter table public.password_recovery_tokens enable row level security;

revoke all on table public.users, public.user_profiles, public.user_sessions, public.songs,
  public.playlists, public.playlist_songs, public.favorites, public.listening_history,
  public.user_settings, public.login_attempts, public.password_recovery_tokens
  from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.users, public.user_profiles, public.user_sessions,
  public.songs, public.playlists, public.playlist_songs, public.favorites, public.listening_history,
  public.user_settings, public.login_attempts, public.password_recovery_tokens to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;

-- El event trigger integrado de Supabase habilita RLS en futuras tablas public.
-- Se mantiene activo, pero anon/authenticated no pueden ejecutar su helper manualmente.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Archivos privados. Los clientes reciben URLs temporales emitidas por la Edge Function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('music-audio', 'music-audio', false, 104857600,
    array['audio/mpeg','audio/mp4','audio/aac','audio/wav','audio/x-wav','audio/ogg','audio/flac','audio/webm','audio/x-m4a','audio/aiff']),
  ('music-covers', 'music-covers', false, 10485760,
    array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
