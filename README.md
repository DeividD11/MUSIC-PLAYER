# MUSIC PLAYER

Reproductor musical personal para navegador, desarrollado con HTML5, CSS3 y JavaScript ES Modules. El frontend es estático y puede publicarse en GitHub Pages; PostgreSQL, Storage y el backend de la aplicación se ejecutan en Supabase.

> **Alcance real:** la biblioteca local utiliza IndexedDB y reproduce archivos elegidos desde el dispositivo. Los metadatos, playlists, favoritos, historial y preferencias se sincronizan con una cuenta cuando hay sesión. Los archivos de audio solo quedan disponibles entre dispositivos cuando el usuario los sube voluntariamente a su Storage privado.

## 1. Tecnología y decisiones

- HTML5 semántico, CSS3 responsive y JavaScript ES2022 nativo.
- Arquitectura MVC modular: `models/`, `views/`, `controllers/`, con `repositories/`, `services/`, `config/` y `utils/` como capas de apoyo.
- `HTMLAudioElement` para la reproducción, cola, aleatorio, repetición, volumen, velocidad y progreso.
- IndexedDB para archivos locales, biblioteca sin conexión, playlists locales, favoritos e historial local.
- Supabase PostgreSQL para metadatos y estado de cuenta; Supabase Storage para audio y portadas privadas.
- Una Supabase Edge Function concentra autenticación personalizada y operaciones de datos.
- Autenticación propia: **no se utiliza Supabase Auth**.
- Contraseñas con Argon2id cargado bajo demanda en el backend (19 MiB, 2 iteraciones para ajustarse al presupuesto de memoria de Edge Functions); tokens de sesión aleatorios, almacenados en la base únicamente como SHA-256.
- Las llamadas del frontend tienen timeout explícito de 60 segundos y cancelación con `AbortController`; la interfaz restaura el botón y muestra un error legible si Supabase no responde.
- La Edge Function responde `OPTIONS` (CORS) antes de importar el SDK de Supabase o Argon2id. El SDK también se inicializa de forma diferida en la primera solicitud POST. Esto evita que una dependencia pesada impida completar el preflight del navegador.
- La clave `sb_publishable_...` es pública y se utiliza en el navegador. La clave secreta de Supabase se consume desde el entorno de Edge Functions y nunca se incluye en el ZIP.

## 2. Requisitos

Para usar la aplicación publicada solo necesitas un navegador moderno. Para desplegar cambios:

- Una cuenta y un proyecto Supabase con acceso de administrador.
- Supabase CLI actual y sesión autorizada.
- Una cuenta GitHub para publicar en GitHub Pages.
- Opcional: una cuenta de Resend y un dominio remitente validado para activar recuperación de contraseña por correo.

No se necesita Node.js, PHP ni Python en el servidor de producción. No hay proceso de compilación del frontend.

## 3. Estructura

```text
music-player/
├── index.html, login.html, register.html, recover-password.html, dashboard.html
├── assets/
│   ├── css/                 # estilos por responsabilidad
│   ├── images/              # recursos visuales propios
│   └── js/
│       ├── config/          # configuración pública
│       ├── models/          # lógica del reproductor
│       ├── views/           # representación DOM
│       ├── controllers/     # coordinación de eventos y modelos
│       ├── repositories/    # IndexedDB
│       ├── services/        # API y carga de archivos
│       └── utils/           # DOM y lectura básica de etiquetas ID3
├── supabase/
│   ├── config.toml
│   ├── migrations/          # esquema inicial registrado en remoto
│   └── functions/music-api/ # API y autenticación personalizadas
├── tests/                   # comprobaciones estáticas reproducibles
├── .env.example
├── .gitignore
└── README.md
```

## 4. Proyecto Supabase conectado

El proyecto previsto por esta entrega es:

- Project ref: `qbmhcudgtjooyyegdhkk`
- URL: `https://qbmhcudgtjooyyegdhkk.supabase.co`
- Publishable key: `sb_publishable_g-fuyJg_6w7D9Fx_6iKZgA_g8rlaaOM`

La URL y la publishable key están centralizadas en `assets/js/config/supabase.config.js`. La publishable key no es un secreto ni concede privilegios administrativos. **No reemplaces ni agregues una contraseña PostgreSQL en ningún archivo del frontend.** El valor `[YOUR-PASSWORD]` de la URI de conexión que se compartió es solo un marcador, no una contraseña utilizable.

### 4.1. Estado de base de datos

Las migraciones `20261031215338_initial_music_player_schema` y `20261031220445_index_foreign_key_columns` fueron aplicadas directamente al proyecto Supabase durante la preparación de esta entrega. La primera crea:

- `users`, `user_profiles`, `user_sessions`.
- `songs`, `playlists`, `playlist_songs`, `favorites`, `listening_history`, `user_settings`.
- `login_attempts` y `password_recovery_tokens`.
- Índices, claves foráneas, restricciones `CHECK`, triggers de actualización y RLS.
- Buckets privados `music-audio` (100 MiB máximo) y `music-covers` (10 MiB máximo), con MIME permitidos. La segunda migración añade índices de soporte para las claves foráneas.

El acceso SQL directo de `anon` y `authenticated` a las tablas de la aplicación está revocado. No hay políticas de lectura pública: las operaciones pasan por la Edge Function y su validación de sesión. La clave secreta/administrativa permanece del lado de Supabase.

### 4.2. Instalar Supabase CLI y vincular

Desde la carpeta raíz del proyecto, instala la versión vigente de Supabase CLI siguiendo la documentación oficial de tu sistema. Luego ejecuta:

```bash
supabase login
supabase link --project-ref qbmhcudgtjooyyegdhkk
```

`supabase/config.toml`, `supabase/functions/` y `supabase/migrations/` ya vienen preparados. No es necesario ejecutar `supabase init` sobre esta carpeta, porque ya existe el directorio `supabase/` y su configuración específica. En un proyecto nuevo y vacío, `supabase init` es el comando que crea esa estructura inicial.

Verifica que la migración esté reconocida:

```bash
supabase migration list --linked
```

Las versiones `20261031215338` y `20261031220445` deben aparecer como aplicadas en remoto. Si alguna aparece pendiente o hay discrepancias de historial, detente y compara `supabase migration list --linked` antes de ejecutar una migración; no fuerces un reset de producción.

Para desplegar la migración local cuando Supabase indique que no está aplicada:

```bash
supabase db push
```

La migración incluida tiene el mismo número de versión que la aplicada durante esta entrega, por lo que en un historial sincronizado no debería volver a ejecutarse.

### 4.3. Desplegar la Edge Function

`supabase/config.toml` fija `verify_jwt = false` únicamente para `music-api`, ya que el sistema no usa JWT de Supabase Auth: el handler valida el encabezado `x-app-session`, verifica la sesión hash en PostgreSQL y obtiene la identidad desde la base de datos. No desactives esa comprobación interna.

```bash
supabase functions deploy music-api
```

En Windows también puedes ejecutar `ACTUALIZAR-SUPABASE.bat` desde la carpeta raíz. El archivo inicia sesión, vincula este proyecto y despliega la versión corregida de `music-api`. No necesita que introduzcas la contraseña de PostgreSQL ni una clave secreta en el frontend.

Después del despliegue, ejecuta en PowerShell `tools\verificar-supabase.ps1`. La comprobación consulta la acción pública `health` y tiene un límite de 20 segundos.


La función devuelve la respuesta CORS `OPTIONS` de forma inmediata y antes de importar dependencias. El SDK Supabase se carga de forma diferida solo después de recibir una solicitud POST válida; Argon2id se carga bajo demanda únicamente para registrar, autenticar o restablecer contraseñas. Este orden evita que la carga inicial de las dependencias bloquee las comprobaciones CORS. La función utiliza las variables administradas por Supabase (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` y `SUPABASE_SECRET_KEYS`). Si tu proyecto o runtime no proporciona una de ellas, revisa **Edge Functions → Secrets** en el Dashboard; no pegues una clave secreta en el frontend ni en Git.

### 4.4. CORS y dominios

La función admite localhost de desarrollo y subdominios HTTPS de `github.io`. Si vas a usar un dominio personalizado, configúralo como secreto en Supabase:

```bash
supabase secrets set ALLOWED_ORIGINS=https://tu-dominio.example
```

Para varios dominios, sepáralos por comas y sin espacios. No uses `*`. CORS no reemplaza la autenticación: toda acción privada también requiere una sesión válida.

### 4.5. Recuperación de contraseña por correo (opcional)

El registro y el inicio de sesión funcionan sin proveedor de correo. La recuperación no simula el envío: hasta configurar Resend, el endpoint indica que el correo no está preparado. Para activarlo, configura secretos en Supabase (sin incluirlos en Git):

```bash
supabase secrets set RESEND_API_KEY=re_tu_clave
supabase secrets set RESEND_FROM_EMAIL='MUSIC PLAYER <cuentas@tu-dominio.example>'
supabase secrets set PUBLIC_APP_URL=https://usuario.github.io/repositorio/
```

El dominio remitente debe estar validado en Resend. `PUBLIC_APP_URL` debe incluir la subruta del repositorio y terminar en `/`, porque el enlace lleva a `recover-password.html`. Los tokens de recuperación son de un solo uso y caducan en una hora.

## 5. Desarrollo local

No abras los HTML mediante `file://`; los módulos ES y las peticiones HTTPS necesitan un origen HTTP. Puedes utilizar VS Code Live Server (puerto 5500) o un servidor estático simple en el directorio del proyecto, por ejemplo:

```bash
python -m http.server 8000
```

Esto sirve archivos estáticos únicamente; no es un backend de aplicación. Abre `http://localhost:8000/`. Los orígenes localhost 5500 y 8000 ya están admitidos por la Edge Function.

## 6. Publicar en GitHub Pages

1. Crea un repositorio GitHub y sube el contenido de esta carpeta.
2. Abre **Settings → Pages**.
3. Selecciona **Deploy from a branch**, rama `main` y carpeta `/ (root)`.
4. Espera a que GitHub Pages publique `index.html`.
5. Abre el origen `https://<usuario>.github.io`. Si usas un dominio personalizado, agrégalo con `ALLOWED_ORIGINS` como se indicó arriba.

Las rutas del frontend son relativas para admitir el despliegue bajo subruta de repositorio. GitHub Pages publica solo el frontend: PostgreSQL, Storage y `music-api` continúan en Supabase.

## 7. Uso de la aplicación

- Importa archivos de audio desde el dispositivo o arrástralos al área de biblioteca.
- El navegador valida MIME/reproducción, tamaño (hasta 100 MiB por archivo) y espacio aproximado de IndexedDB.
- Las etiquetas de texto ID3 disponibles se leen de MP3; los datos no disponibles se pueden editar desde la biblioteca.
- Reproduce, pausa, busca, cambia de pista, ajusta volumen/velocidad, activa aleatorio y repetición, y administra la cola.
- Crea playlists, agrega canciones, administra favoritos e historial.
- Inicia sesión para sincronizar metadatos y listas.
- Usa el botón de nube de una canción para subir el audio a `music-audio`; desde ese momento el archivo puede recuperarse con URL firmada de corta duración en otros dispositivos.

Los archivos de `source_type = local` se conservan en IndexedDB del dispositivo. Nunca se anuncian como sincronizados ni se suben sin una acción explícita. Al eliminar una canción sincronizada, el backend elimina su audio/portada de Storage y su metadato; elimina también su copia local en ese dispositivo.

## 8. Seguridad

- No se implementa Supabase Auth ni se accede a `auth.users`.
- No se almacenan contraseñas en texto plano. Argon2id corre dentro de la Edge Function.
- La base guarda SHA-256 del token de sesión, no el token original. El cliente conserva el token temporalmente en `sessionStorage`; evita extensiones y scripts de terceros no confiables.
- La sesión caduca a los 14 días y se puede revocar al cerrar sesión o cambiar la contraseña.
- Las tablas privadas tienen RLS activado y privilegios públicos revocados. Solo el backend administrativo consulta las tablas, después de validar identidad y propiedad del registro.
- El proyecto incluye política CSP en las páginas y usa `textContent` para texto dinámico.
- Storage es privado; los enlaces firmados expiran.
- No subas `.env`, claves secretas, contraseñas de Postgres ni `service_role`/secret keys a GitHub.

## 9. Pruebas y verificación

Pruebas estáticas reproducibles:

```bash
node --version
npm test
```

El test verifica referencias entre HTML y assets, importaciones relativas, configuración de proyecto, presencia de controles esenciales, restricciones de seguridad y estructura de migración. También puedes ejecutar `node --check` sobre cada archivo JavaScript. El runtime de Edge Functions es Deno; para comprobar tipos y sintaxis backend con el entorno oficial, consulta `supabase functions serve music-api` después de instalar Supabase CLI y Deno.

Plan de pruebas funcionales manuales:

1. Crear una cuenta; confirmar que aparece en `public.users` sin contraseña legible.
2. Cerrar sesión, iniciar sesión y recargar `dashboard.html`.
3. Probar un correo/contraseña erróneos y verificar la limitación de intentos.
4. Importar un MP3 y comprobar reproducción, pausa, siguiente/anterior, progreso, volumen, aleatorio y repetición.
5. Crear playlist, añadir y retirar canciones; probar favoritos e historial.
6. Con sesión iniciada, subir un archivo desde el botón de nube y confirmar que se crea un objeto en el bucket privado.
7. Iniciar sesión desde otro navegador y verificar metadatos/listas; comprobar que el audio subido sí puede reproducirse y que el audio local no subido no se presenta como disponible remotamente.
8. Probar la recuperación solo después de configurar Resend.
9. Publicar en GitHub Pages y probar desde el origen HTTPS final.

No se declaran superadas las pruebas de navegador, audio real, correo, producción GitHub Pages o aislamiento con múltiples cuentas desde este entorno. Estas requieren credenciales de usuario, dispositivos/navegadores y el dominio final.

## 10. Limitaciones conocidas

- No se extrae ni descarga audio desde Spotify, YouTube ni plataformas de terceros. Utiliza archivos que tengas derecho a reproducir.
- El análisis ID3 incluido es básico y enfocado en etiquetas MP3 de texto; no extrae automáticamente imágenes incrustadas de todas las variantes de ID3.
- La interfaz maneja reproducción local y de Storage; la sincronización offline de cambios pendientes aún no es una cola de reintentos completa.
- La recuperación por correo requiere Resend configurado y un remitente verificado.
- No existe integración de streaming comercial ni catálogo externo.
- Las playlists se sincronizan; la cola del reproductor es de sesión local.

## 11. Mantenimiento

- Mantén `SUPABASE_CONFIG` centralizado en `assets/js/config/supabase.config.js`.
- Para cambios de esquema, crea una nueva migración con `supabase migration new nombre_en_snake_case`, revisa el SQL y aplica primero en un entorno de prueba.
- Despliega cambios de Edge Function con `supabase functions deploy music-api`.
- Revisa los Security y Performance Advisors después de cambios de RLS, funciones, índices o Storage.
- Controla el tamaño del historial y los límites de Storage antes de habilitar cargas amplias.
- Cambia `ALLOWED_ORIGINS` cuando modifiques el dominio de publicación.

## 12. Documentación oficial

- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase Storage](https://supabase.com/docs/guides/storage)
- [Supabase CLI](https://supabase.com/docs/reference/cli/introduction)
- [GitHub Pages](https://docs.github.com/pages)
