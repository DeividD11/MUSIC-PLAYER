export const SUPABASE_CONFIG = Object.freeze({
  url: 'https://qbmhcudgtjooyyegdhkk.supabase.co',
  publishableKey: 'sb_publishable_g-fuyJg_6w7D9Fx_6iKZgA_g8rlaaOM',
  functionUrl: 'https://qbmhcudgtjooyyegdhkk.supabase.co/functions/v1/music-api',
  audioBucket: 'music-audio',
  coverBucket: 'music-covers',
});

export const APP_CONFIG = Object.freeze({
  sessionStorageKey: 'mp_session',
  userStorageKey: 'mp_user',
  pageSize: 100,
  localDatabase: 'music-player-local',
  localDatabaseVersion: 1,
});
