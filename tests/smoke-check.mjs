import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const htmlFiles = ['index.html', 'login.html', 'register.html', 'recover-password.html', 'dashboard.html'];
for (const file of htmlFiles) {
  check(exists(file), `Falta ${file}`);
  const source = read(file);
  check(source.includes('Content-Security-Policy'), `${file}: falta Content-Security-Policy`);
  for (const match of source.matchAll(/(?:src|href)="(\.\/[^"?#]+)"/g)) {
    const asset = match[1];
    if (/\.(?:css|js|svg)$/.test(asset)) check(exists(asset.replace(/^\.\//, '')), `${file}: referencia rota ${asset}`);
  }
}

const jsFiles = [];
function walk(directory) {
  for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory, item.name);
    if (item.isDirectory()) walk(relative);
    else if (item.name.endsWith('.js')) jsFiles.push(relative);
  }
}
walk('assets/js');
for (const file of jsFiles) {
  const source = read(file);
  for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.\.?\/[^'"]+)['"]/g)) {
    const resolved = path.resolve(path.dirname(path.join(root, file)), match[1]);
    check(fs.existsSync(resolved), `${file}: import no encontrado ${match[1]}`);
  }
}

const config = read('assets/js/config/supabase.config.js');
check(config.includes('https://qbmhcudgtjooyyegdhkk.supabase.co'), 'URL Supabase incorrecta o ausente');
check(config.includes('sb_publishable_g-fuyJg_6w7D9Fx_6iKZgA_g8rlaaOM'), 'Publishable key incorrecta o ausente');
check(!config.toLowerCase().includes('service_role'), 'El cliente no debe contener service_role');
check(!config.includes('[YOUR-PASSWORD]'), 'El frontend no debe contener URI PostgreSQL');

const api = read('assets/js/services/api-client.js');
check(api.includes("'x-app-session'"), 'Falta encabezado de sesión personalizada');
check(api.includes('AbortController') && api.includes('request_timeout'), 'Las llamadas API deben tener timeout y error recuperable');
check(!api.includes('supabase.auth'), 'No debe utilizar Supabase Auth');
const edge = read('supabase/functions/music-api/index.ts');
for (const item of ['argon2id', 'argon2Verify', 'x-app-session', 'auth.register', 'auth.login', 'playlists.add-song', 'favorites.add', 'history.add', 'settings.update']) {
  check(edge.includes(item), `Edge Function: falta implementación ${item}`);
}
check(edge.includes('SUPABASE_SECRET_KEYS'), 'Edge Function debe obtener clave secreta de entorno');
check(edge.includes('getArgonModule') && edge.includes('memorySize:19456'), 'Argon2id debe cargarse bajo demanda y respetar el presupuesto de memoria Edge');
check(!edge.includes('import { createClient } from "npm:@supabase/supabase-js'), 'Supabase JS no debe ser importado estáticamente al iniciar el worker');
check(edge.indexOf('req.method === "OPTIONS"') < edge.indexOf('await initializeDb()'), 'CORS OPTIONS debe responder antes de inicializar el SDK');
check(edge.includes('status: 204') && edge.includes('cors-lazy-v4'), 'La respuesta CORS debe ser inmediata y la versión estar identificada');
check(edge.includes('originOK'), 'Edge Function debe validar CORS');
check(!edge.includes('Access-Control-Allow-Origin": "*"'), 'CORS no debe permitir cualquier origen');
check(exists('supabase/migrations/20261031215338_initial_music_player_schema.sql'), 'Falta migración inicial');
check(exists('supabase/migrations/20261031220445_index_foreign_key_columns.sql'), 'Falta migración de índices de claves foráneas');
const migration = read('supabase/migrations/20261031215338_initial_music_player_schema.sql');
for (const table of ['users', 'user_sessions', 'songs', 'playlists', 'playlist_songs', 'favorites', 'listening_history', 'user_settings', 'login_attempts', 'password_recovery_tokens']) {
  check(migration.includes(`public.${table}`), `Migración: falta ${table}`);
}
check((migration.match(/enable row level security/gi) || []).length >= 11, 'Migración: faltan sentencias RLS');
check(migration.includes("'music-audio'") && migration.includes("'music-covers'"), 'Migración: faltan buckets de Storage');

if (failures.length) {
  console.error(`FALLÓ: ${failures.length} comprobación(es)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`OK: ${htmlFiles.length} páginas, ${jsFiles.length} módulos JS, imports, configuración, migración y controles de seguridad.`);
}
