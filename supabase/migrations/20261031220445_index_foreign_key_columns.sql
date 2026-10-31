-- Índices de soporte para cubrir todas las claves foráneas compuestas/simples.
create index if not exists favorites_song_user_idx
  on public.favorites(song_id, user_id);
create index if not exists listening_history_song_idx
  on public.listening_history(song_id);
create index if not exists playlist_songs_playlist_user_idx
  on public.playlist_songs(playlist_id, user_id);
create index if not exists playlist_songs_song_user_idx
  on public.playlist_songs(song_id, user_id);
create index if not exists playlist_songs_user_idx
  on public.playlist_songs(user_id);
