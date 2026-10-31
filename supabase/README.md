# Supabase: MUSIC PLAYER

La función `music-api` implementa autenticación y acciones de datos sin Supabase Auth. Las peticiones llevan `apikey` (publishable key) y, para acciones privadas, `x-app-session` (token personalizado). La función valida origen, publishable key, token aleatorio, expiración, revocación y propietario del recurso antes de cada lectura/escritura.

## Despliegue

```bash
supabase login
supabase link --project-ref qbmhcudgtjooyyegdhkk
supabase migration list --linked
supabase db push
supabase functions deploy music-api
```

La migración `20261031215338_initial_music_player_schema.sql` se aplicó de manera remota en la preparación del proyecto. Comprueba que esa versión figure aplicada antes de ejecutar `db push`.

La función lee `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` y `SUPABASE_SECRET_KEYS` del entorno administrado por Supabase. No añadas claves administrativas a `assets/` ni las publiques.

Opcionalmente configura:

- `ALLOWED_ORIGINS`: orígenes HTTPS personalizados separados por coma (los `*.github.io` y localhost predefinidos ya están contemplados).
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PUBLIC_APP_URL`: envío real de recuperación de contraseña.

El bucket `music-audio` y `music-covers` son privados. La Edge Function entrega URLs firmadas y URLs firmadas para carga. No añadas políticas públicas de Storage.
