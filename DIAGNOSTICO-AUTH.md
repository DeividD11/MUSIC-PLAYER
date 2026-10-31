# Corrección de bloqueo en registro e inicio de sesión

## Causa encontrada
Los registros de Supabase mostraban que las solicitudes del navegador `OPTIONS` a `music-api` agotaban el worker (`WORKER_RESOURCE_LIMIT`, HTTP 546) o terminaban por `IDLE_TIMEOUT` (HTTP 504), a los 150 segundos. El navegador nunca alcanzaba a enviar el POST de registro o login, porque el preflight CORS no recibía una respuesta.

## Qué cambió
- `OPTIONS` se resuelve primero, con HTTP 204 y cabeceras CORS, sin inicializar servicios.
- `@supabase/supabase-js` ahora se importa dinámicamente después del preflight y solo para POST.
- Argon2id sigue cargándose bajo demanda y mantiene 19 MiB / 2 iteraciones.
- El frontend tiene timeout de 60 segundos y restaura el botón al terminar tanto si la operación funciona como si falla.
- Se añade una prueba de regresión para verificar que CORS ocurre antes de inicializar el SDK.

## Despliegue
La versión corregida se debe desplegar con:

```bash
supabase login
supabase link --project-ref qbmhcudgtjooyyegdhkk
supabase functions deploy music-api
```

También se puede ejecutar `ACTUALIZAR-SUPABASE.bat`.

## Comprobación
Ejecuta `tools\\verificar-supabase.ps1`. Debe devolver `OK: music-api responde correctamente.`. Después, desde GitHub Pages, recarga con Ctrl+F5 y prueba registro e inicio de sesión.

La verificación de HTTP extremo a extremo desde este entorno de trabajo está limitada por DNS; el despliegue y el estado ACTIVE de la función se verifican mediante Supabase. No se deben compartir contraseñas ni claves secretas para realizar estas pruebas.
