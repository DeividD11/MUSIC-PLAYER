// Supabase SDK is imported only after the CORS preflight branch.

type Payload = Record<string, unknown>;
const SESSION_DAYS = 14;
const AUDIO_BUCKET = "music-audio";
const COVER_BUCKET = "music-covers";
const AUDIO_TYPES = new Set(["audio/mpeg","audio/mp4","audio/aac","audio/wav","audio/x-wav","audio/ogg","audio/flac","audio/webm","audio/x-m4a","audio/aiff"]);
const COVER_TYPES = new Set(["image/jpeg","image/png","image/webp","image/avif"]);
const AUDIO_MAX = 100 * 1024 * 1024;
const COVER_MAX = 10 * 1024 * 1024;
const url = Deno.env.get("SUPABASE_URL") ?? "";
const parse = (s: string) => { try { return JSON.parse(Deno.env.get(s) ?? "{}"); } catch { return {}; } };
const pubKeys = parse("SUPABASE_PUBLISHABLE_KEYS");
const secKeys = parse("SUPABASE_SECRET_KEYS");
const publicKey = String(pubKeys.default ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "");
const secretKey = String(secKeys.default ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
let db: any = null;
let dbPromise: Promise<any> | null = null;
async function initializeDb() {
  dbPromise ??= (async () => {
    const { createClient } = await import("npm:@supabase/supabase-js@2.118.0");
    if (!url || !secretKey) throw new Error("Supabase server secret is not configured");
    return createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  })();
  db = await dbPromise;
  return db;
}
const enc = new TextEncoder();
let argonModulePromise: Promise<typeof import("npm:hash-wasm@4.12.0")> | null = null;

async function getArgonModule() {
  argonModulePromise ??= import("npm:hash-wasm@4.12.0");
  return await argonModulePromise;
}

function origins(): Set<string> {
  const extra = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return new Set(["http://localhost:5500","http://127.0.0.1:5500","http://localhost:8000","http://127.0.0.1:8000",...extra]);
}
function originOK(o: string): boolean {
  return origins().has(o) || /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\.github\.io$/i.test(o);
}
function headers(o: string | null): HeadersInit {
  const h: Record<string,string> = { "Vary":"Origin","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"content-type, apikey, x-app-session","Access-Control-Max-Age":"86400" };
  if (o && originOK(o)) h["Access-Control-Allow-Origin"] = o;
  return h;
}
function out(body: unknown, status = 200, o: string | null = null): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers(o), "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store" } });
}
function ok(data: unknown, status = 200, o: string | null = null) { return out({ ok:true, data }, status, o); }
function bad(message: string, status = 400, code = "request_error", o: string | null = null) { return out({ ok:false, error:{ message, code } }, status, o); }
function text(v: unknown, max = 250): string { return typeof v === "string" ? v.trim().slice(0,max) : ""; }
function emailOK(v: string): boolean { return v.length >= 5 && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function passwordOK(v: unknown): v is string { return typeof v === "string" && v.length >= 12 && v.length <= 128; }
function uuid(v: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v); }
function token(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
async function sha(v: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(v));
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2,"0")).join("");
}
async function passwordHash(p: string): Promise<string> {
  const { argon2id } = await getArgonModule();
  // 19 MiB / 2 iterations keeps Argon2id within the Edge Function memory budget.
  return String(await argon2id({ password:p, salt:crypto.getRandomValues(new Uint8Array(16)), parallelism:1, iterations:2, memorySize:19456, hashLength:32, outputType:"encoded" }));
}
async function passwordVerify(p: string, hash: string): Promise<boolean> {
  const { argon2Verify } = await getArgonModule();
  return await argon2Verify({ password:p, hash });
}
function userSafe(u: Payload) { return { id:u.id, username:u.username, email:u.email, created_at:u.created_at }; }
async function createSession(userId: string, req: Request) {
  if (!db) throw new Error("db unavailable");
  const t = token(), expires = new Date(Date.now() + SESSION_DAYS*86400000).toISOString();
  const { error } = await db.from("user_sessions").insert({ user_id:userId, token_hash:await sha(t), expires_at:expires, user_agent:(req.headers.get("user-agent") ?? "").slice(0,400) });
  if (error) throw error;
  return { token:t, expires_at:expires };
}
async function currentUser(req: Request) {
  if (!db) return null;
  const t = req.headers.get("x-app-session") ?? "";
  if (t.length < 30 || t.length > 200) return null;
  const { data:s } = await db.from("user_sessions").select("id,user_id").eq("token_hash",await sha(t)).is("revoked_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
  if (!s) return null;
  const { data:u } = await db.from("users").select("id,username,email,created_at,is_active").eq("id",s.user_id).eq("is_active",true).maybeSingle();
  return u ? { user:u, sessionId:s.id } : null;
}
function storagePath(v: unknown, uid: string): string | null {
  if (typeof v !== "string" || v.length > 600 || !v.startsWith(uid + "/") || v.includes("..") || v.startsWith("/")) return null;
  return v;
}
async function signed(bucket: string, path: string | null, seconds = 3600): Promise<string | null> {
  if (!db || !path) return null;
  const { data,error } = await db.storage.from(bucket).createSignedUrl(path,seconds);
  return error ? null : data?.signedUrl ?? null;
}
async function authRegister(p: Payload, req: Request, o: string | null) {
  if (!db) return bad("El backend no está configurado.",503,"backend_unavailable",o);
  const username = text(p.username,30).toLowerCase(), email = text(p.email,254).toLowerCase(), pass = p.password;
  if (!/^[a-z0-9_]{3,30}$/.test(username)) return bad("El usuario debe tener de 3 a 30 caracteres: letras, números o guion bajo.",422,"invalid_username",o);
  if (!emailOK(email)) return bad("Escribe un correo válido.",422,"invalid_email",o);
  if (!passwordOK(pass)) return bad("La contraseña debe tener entre 12 y 128 caracteres.",422,"weak_password",o);
  const { data:u,error } = await db.from("users").insert({ username,email,password_hash:await passwordHash(pass) }).select("id,username,email,created_at").single();
  if (error || !u) return bad(error?.code === "23505" ? "Ese correo o usuario ya está registrado." : "No fue posible crear la cuenta.",error?.code === "23505" ? 409 : 500,"registration_failed",o);
  const [pr,sr] = await Promise.all([
    db.from("user_profiles").insert({ user_id:u.id,display_name:text(p.displayName,80) || username }),
    db.from("user_settings").insert({ user_id:u.id })
  ]);
  if (pr.error || sr.error) { await db.from("users").delete().eq("id",u.id); return bad("No fue posible inicializar la cuenta.",500,"registration_failed",o); }
  try { return ok({ user:userSafe(u), session:await createSession(u.id,req) },201,o); }
  catch { await db.from("users").delete().eq("id",u.id); return bad("No fue posible iniciar la sesión.",500,"session_creation_failed",o); }
}
async function authLogin(p: Payload, req: Request, o: string | null) {
  if (!db) return bad("El backend no está configurado.",503,"backend_unavailable",o);
  const id = text(p.identifier,254).toLowerCase(), pass = p.password;
  if (!id || typeof pass !== "string" || pass.length > 128) return bad("Credenciales incorrectas.",401,"invalid_credentials",o);
  const ih = await sha(id), since = new Date(Date.now()-15*60000).toISOString();
  const { count } = await db.from("login_attempts").select("id",{count:"exact",head:true}).eq("identifier_hash",ih).eq("succeeded",false).gte("created_at",since);
  if ((count ?? 0) >= 10) return bad("Demasiados intentos. Espera 15 minutos.",429,"rate_limited",o);
  const col = id.includes("@") ? "email" : "username";
  const { data:u } = await db.from("users").select("id,username,email,password_hash,is_active,created_at").eq(col,id).maybeSingle();
  let valid = false;
  if (u?.is_active) { try { valid = await passwordVerify(pass, u.password_hash); } catch { valid = false; } }
  await db.from("login_attempts").insert({ identifier_hash:ih,succeeded:valid });
  if (Math.random() < 0.05) await db.from("login_attempts").delete().lt("created_at",new Date(Date.now()-86400000).toISOString());
  if (!valid || !u) return bad("Credenciales incorrectas.",401,"invalid_credentials",o);
  try { return ok({ user:userSafe(u),session:await createSession(u.id,req) },200,o); }
  catch { return bad("No fue posible iniciar la sesión.",500,"session_creation_failed",o); }
}
async function authMe(uid: string, o: string | null, user: Payload) {
  if (!db) return bad("El backend no está configurado.",503,"backend_unavailable",o);
  const [p,s] = await Promise.all([
    db.from("user_profiles").select("display_name,avatar_path").eq("user_id",uid).maybeSingle(),
    db.from("user_settings").select("theme,volume,playback_speed,repeat_mode,shuffle").eq("user_id",uid).maybeSingle()
  ]);
  return ok({ user:userSafe(user),profile:p.data ?? null,settings:s.data ?? null },200,o);
}
async function resetRequest(p: Payload, o: string | null) {
  if (!db) return bad("El backend no está configurado.",503,"backend_unavailable",o);
  const key = Deno.env.get("RESEND_API_KEY") ?? "", from = Deno.env.get("RESEND_FROM_EMAIL") ?? "", app = Deno.env.get("PUBLIC_APP_URL") ?? "";
  if (!key || !from || !app) return bad("La recuperación por correo no está configurada. Añade RESEND_API_KEY, RESEND_FROM_EMAIL y PUBLIC_APP_URL.",503,"mail_not_configured",o);
  const email = text(p.email,254).toLowerCase();
  if (!emailOK(email)) return bad("Escribe un correo válido.",422,"invalid_email",o);
  const { data:u } = await db.from("users").select("id,email").eq("email",email).eq("is_active",true).maybeSingle();
  if (!u) return ok({ message:"Si la cuenta existe, recibirás instrucciones de recuperación." },200,o);
  const t = token(), hash = await sha(t), expires = new Date(Date.now()+3600000).toISOString();
  const { error } = await db.from("password_recovery_tokens").insert({ user_id:u.id,token_hash:hash,expires_at:expires });
  if (error) return bad("No se pudo iniciar la recuperación.",500,"recovery_failed",o);
  const base = app.endsWith("/") ? app : app + "/";
  const recovery = new URL("recover-password.html",base); recovery.searchParams.set("token",t);
  const mail = await fetch("https://api.resend.com/emails",{ method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({from,to:[u.email],subject:"Recupera tu contraseña de MUSIC PLAYER",html:"<p>Solicitaste cambiar tu contraseña.</p><p><a href=\"" + recovery.toString() + "\">Crear una contraseña nueva</a></p><p>El enlace vence en una hora. Si no solicitaste este cambio, ignora el mensaje.</p>"}) });
  if (!mail.ok) { await db.from("password_recovery_tokens").delete().eq("token_hash",hash); return bad("El proveedor de correo no pudo enviar el mensaje.",502,"mail_delivery_failed",o); }
  return ok({ message:"Si la cuenta existe, recibirás instrucciones de recuperación." },200,o);
}
async function resetPassword(p: Payload, o: string | null) {
  if (!db) return bad("El backend no está configurado.",503,"backend_unavailable",o);
  const t = text(p.token,200), pass = p.password;
  if (t.length < 30) return bad("El enlace no es válido.",422,"invalid_recovery_token",o);
  if (!passwordOK(pass)) return bad("La contraseña debe tener entre 12 y 128 caracteres.",422,"weak_password",o);
  const { data:r } = await db.from("password_recovery_tokens").select("id,user_id").eq("token_hash",await sha(t)).is("consumed_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
  if (!r) return bad("El enlace expiró o ya fue utilizado.",410,"recovery_expired",o);
  const { error } = await db.from("users").update({password_hash:await passwordHash(pass)}).eq("id",r.user_id);
  if (error) return bad("No fue posible cambiar la contraseña.",500,"password_update_failed",o);
  const now = new Date().toISOString();
  await Promise.all([
    db.from("password_recovery_tokens").update({consumed_at:now}).eq("id",r.id),
    db.from("user_sessions").update({revoked_at:now}).eq("user_id",r.user_id).is("revoked_at",null)
  ]);
  return ok({message:"Contraseña actualizada. Inicia sesión con la nueva contraseña."},200,o);
}
async function library(uid: string, action: string, p: Payload, o: string | null) {
  if (!db) return bad("El backend no está configurado.",503,"backend_unavailable",o);
  if (action === "library.list") {
    const limit = Math.max(1,Math.min(100,Number(p.limit)||100)), offset = Math.max(0,Math.min(100000,Number(p.offset)||0));
    let q = db.from("songs").select("*").eq("user_id",uid).order("created_at",{ascending:false}).range(offset,offset+limit-1);
    const search = text(p.search,100).replace(/[,%()]/g," ");
    if (search) q = q.or("title.ilike.%" + search + "%,artist.ilike.%" + search + "%,album.ilike.%" + search + "%,genre.ilike.%" + search + "%");
    const {data,error} = await q;
    if (error) return bad("No fue posible consultar la biblioteca.",500,"library_read_failed",o);
    const songs = await Promise.all((data ?? []).map(async (s) => ({...s,audio_url:s.source_type === "storage" ? await signed(AUDIO_BUCKET,s.audio_path) : null,cover_url:await signed(COVER_BUCKET,s.cover_path)})));
    return ok({songs,offset,limit,has_more:songs.length === limit},200,o);
  }
  if (action === "library.create") {
    const title = text(p.title,250), source = p.source_type === "storage" ? "storage" : "local";
    const audio = source === "storage" ? storagePath(p.audio_path,uid) : null;
    const cover = p.cover_path ? storagePath(p.cover_path,uid) : null;
    if (!title || (source === "storage" && !audio)) return bad("Datos de canción o ruta de audio inválidos.",422,"invalid_song",o);
    if (audio && !await signed(AUDIO_BUCKET,audio,60)) return bad("El archivo de audio no existe en tu almacenamiento.",422,"audio_missing",o);
    if (cover && !await signed(COVER_BUCKET,cover,60)) return bad("La portada no existe en tu almacenamiento.",422,"cover_missing",o);
    const id = text(p.id,50);
    const record: Payload = {user_id:uid,title,artist:text(p.artist,250),album:text(p.album,250),genre:text(p.genre,100),duration_seconds:p.duration_seconds == null ? null : Math.max(0,Math.floor(Number(p.duration_seconds)||0)),source_type:source,audio_path:audio,cover_path:cover,mime_type:text(p.mime_type,100)||null,file_size_bytes:p.file_size_bytes == null ? null : Math.max(0,Math.floor(Number(p.file_size_bytes)||0)),original_file_name:text(p.original_file_name,255)||null,metadata:p.metadata && typeof p.metadata === "object" ? p.metadata : {}};
    if (uuid(id)) record.id = id;
    const {data,error} = await db.from("songs").insert(record).select("*").single();
    if (error || !data) return bad("No fue posible guardar la canción.",500,"song_create_failed",o);
    return ok({song:{...data,audio_url:await signed(AUDIO_BUCKET,data.audio_path),cover_url:await signed(COVER_BUCKET,data.cover_path)}},201,o);
  }
  if (action === "library.update") {
    const id = text(p.id,50), ch: Payload = {};
    for (const f of ["title","artist","album","genre"]) if (p[f] !== undefined) ch[f] = text(p[f],f === "genre" ? 100 : 250);
    if (p.duration_seconds !== undefined) ch.duration_seconds = p.duration_seconds == null ? null : Math.max(0,Math.floor(Number(p.duration_seconds)||0));
    if (!id || !Object.keys(ch).length || (ch.title !== undefined && !ch.title)) return bad("No hay cambios válidos.",422,"empty_update",o);
    const {data,error} = await db.from("songs").update(ch).eq("id",id).eq("user_id",uid).select("*").maybeSingle();
    if (error || !data) return bad("No se encontró la canción.",404,"song_not_found",o);
    return ok({song:data},200,o);
  }
  if (action === "library.attach-files") {
    const id = text(p.id,50), ch: Payload = {};
    if (p.audio_path !== undefined) {
      const a = storagePath(p.audio_path,uid);
      if (!a || !await signed(AUDIO_BUCKET,a,60)) return bad("No se pudo validar el audio.",422,"audio_missing",o);
      ch.audio_path = a; ch.source_type = "storage";
      if (p.mime_type !== undefined) ch.mime_type = text(p.mime_type,100);
      if (p.file_size_bytes !== undefined) ch.file_size_bytes = Math.max(0,Math.floor(Number(p.file_size_bytes)||0));
    }
    if (p.cover_path !== undefined) {
      const c = p.cover_path === null ? null : storagePath(p.cover_path,uid);
      if (c && !await signed(COVER_BUCKET,c,60)) return bad("No se pudo validar la portada.",422,"cover_missing",o);
      ch.cover_path = c;
    }
    const {data,error} = await db.from("songs").update(ch).eq("id",id).eq("user_id",uid).select("*").maybeSingle();
    if (error || !data) return bad("No se pudo vincular el archivo.",404,"song_not_found",o);
    return ok({song:{...data,audio_url:await signed(AUDIO_BUCKET,data.audio_path),cover_url:await signed(COVER_BUCKET,data.cover_path)}},200,o);
  }
  if (action === "library.upload-url") {
    const kind = p.kind === "cover" ? "cover" : "audio", mime = text(p.mime_type,100).toLowerCase();
    const name = text(p.file_name,255).replace(/[^a-zA-Z0-9._-]/g,"_").slice(-120) || "upload";
    const size = Math.floor(Number(p.file_size_bytes)||0), allowed = kind === "cover" ? COVER_TYPES : AUDIO_TYPES, max = kind === "cover" ? COVER_MAX : AUDIO_MAX;
    if (!allowed.has(mime)) return bad("El tipo MIME no está permitido.",415,"unsupported_file_type",o);
    if (size <= 0 || size > max) return bad("El archivo supera el límite de tamaño.",413,"file_too_large",o);
    const bucket = kind === "cover" ? COVER_BUCKET : AUDIO_BUCKET, path = uid + "/" + crypto.randomUUID() + "-" + name;
    const {data,error} = await db.storage.from(bucket).createSignedUploadUrl(path);
    if (error || !data?.token) return bad("No fue posible preparar la carga.",500,"upload_url_failed",o);
    return ok({bucket,path,token:data.token,signed_url:data.signedUrl ?? null},200,o);
  }
  if (action === "library.refresh-url") {
    const {data:s} = await db.from("songs").select("id,source_type,audio_path,cover_path").eq("id",text(p.id,50)).eq("user_id",uid).maybeSingle();
    if (!s) return bad("La canción no existe o no te pertenece.",404,"song_not_found",o);
    return ok({audio_url:s.source_type === "storage" ? await signed(AUDIO_BUCKET,s.audio_path) : null,cover_url:await signed(COVER_BUCKET,s.cover_path)},200,o);
  }
  if (action === "library.delete") {
    const id = text(p.id,50);
    const {data:s} = await db.from("songs").select("id,audio_path,cover_path,source_type").eq("id",id).eq("user_id",uid).maybeSingle();
    if (!s) return bad("La canción no existe o no te pertenece.",404,"song_not_found",o);
    if (s.audio_path) await db.storage.from(AUDIO_BUCKET).remove([s.audio_path]);
    if (s.cover_path) await db.storage.from(COVER_BUCKET).remove([s.cover_path]);
    const {error} = await db.from("songs").delete().eq("id",id).eq("user_id",uid);
    if (error) return bad("No fue posible eliminar la canción.",500,"song_delete_failed",o);
    return ok({deleted:id},200,o);
  }
  return bad("Acción de biblioteca desconocida.",404,"unknown_action",o);
}
async function playlists(uid: string, action: string, p: Payload, o: string | null) {
  if (!db) return bad("Backend no configurado.",503,"backend_unavailable",o);
  if (action === "playlists.list") {
    const [a,b] = await Promise.all([db.from("playlists").select("id,name,description,created_at,updated_at").eq("user_id",uid).order("updated_at",{ascending:false}),db.from("playlist_songs").select("playlist_id,song_id,position,added_at").eq("user_id",uid).order("position")]);
    if (a.error || b.error) return bad("No fue posible cargar playlists.",500,"playlist_read_failed",o);
    const map = new Map<string,Payload[]>();
    for (const row of b.data ?? []) map.set(row.playlist_id,[...(map.get(row.playlist_id) ?? []),row]);
    return ok({playlists:(a.data ?? []).map((x) => ({...x,items:map.get(x.id) ?? []}))},200,o);
  }
  const id = text(p.id,50);
  if (action === "playlists.create") {
    const name = text(p.name,100); if (!name) return bad("Escribe un nombre para la playlist.",422,"invalid_playlist",o);
    const rec: Payload = {user_id:uid,name,description:text(p.description,500)};
    if (uuid(id)) rec.id = id;
    const {data,error} = await db.from("playlists").insert(rec).select("*").single();
    if (error || !data) return bad("No fue posible crear la playlist.",500,"playlist_create_failed",o);
    return ok({playlist:data},201,o);
  }
  if (action === "playlists.update") {
    const ch: Payload = {};
    if (p.name !== undefined) ch.name = text(p.name,100);
    if (p.description !== undefined) ch.description = text(p.description,500);
    if (!Object.keys(ch).length || (ch.name !== undefined && !ch.name)) return bad("Datos de playlist inválidos.",422,"invalid_playlist",o);
    const {data,error} = await db.from("playlists").update(ch).eq("id",id).eq("user_id",uid).select("*").maybeSingle();
    if (error || !data) return bad("No se encontró la playlist.",404,"playlist_not_found",o);
    return ok({playlist:data},200,o);
  }
  if (action === "playlists.delete") {
    const {error} = await db.from("playlists").delete().eq("id",id).eq("user_id",uid);
    if (error) return bad("No se pudo eliminar la playlist.",500,"playlist_delete_failed",o);
    return ok({deleted:id},200,o);
  }
  const pid = text(p.playlist_id,50), sid = text(p.song_id,50);
  if (action === "playlists.add-song") {
    const [pl,so,ct] = await Promise.all([db.from("playlists").select("id").eq("id",pid).eq("user_id",uid).maybeSingle(),db.from("songs").select("id").eq("id",sid).eq("user_id",uid).maybeSingle(),db.from("playlist_songs").select("song_id",{count:"exact",head:true}).eq("playlist_id",pid).eq("user_id",uid)]);
    if (!pl.data || !so.data) return bad("La lista o la canción no te pertenecen.",404,"resource_not_found",o);
    const {error} = await db.from("playlist_songs").upsert({playlist_id:pid,song_id:sid,user_id:uid,position:ct.count ?? 0},{onConflict:"playlist_id,song_id"});
    if (error) return bad("No se pudo agregar la canción.",500,"playlist_add_failed",o);
    return ok({playlist_id:pid,song_id:sid},200,o);
  }
  if (action === "playlists.remove-song") {
    const {error} = await db.from("playlist_songs").delete().eq("playlist_id",pid).eq("song_id",sid).eq("user_id",uid);
    if (error) return bad("No se pudo retirar la canción.",500,"playlist_remove_failed",o);
    return ok({playlist_id:pid,song_id:sid},200,o);
  }
  if (action === "playlists.reorder") {
    const ids = Array.isArray(p.song_ids) ? p.song_ids.map((x) => text(x,50)) : [];
    if (!pid || ids.length > 500 || new Set(ids).size !== ids.length || ids.some((x) => !uuid(x))) return bad("Orden inválido.",422,"invalid_order",o);
    const [pl,so] = await Promise.all([db.from("playlists").select("id").eq("id",pid).eq("user_id",uid).maybeSingle(),db.from("songs").select("id").eq("user_id",uid).in("id",ids)]);
    if (!pl.data || (so.data?.length ?? 0) !== ids.length) return bad("La lista contiene canciones ajenas.",403,"forbidden_song",o);
    if (ids.length) {
      const {error} = await db.from("playlist_songs").upsert(ids.map((song_id,position) => ({playlist_id:pid,song_id,user_id:uid,position})),{onConflict:"playlist_id,song_id"});
      if (error) return bad("No se pudo guardar el orden.",500,"reorder_failed",o);
      const {error:cleanup} = await db.from("playlist_songs").delete().eq("playlist_id",pid).eq("user_id",uid).not("song_id","in","(" + ids.join(",") + ")");
      if (cleanup) return bad("El orden quedó guardado, pero no se pudo limpiar la lista.",500,"reorder_cleanup_failed",o);
    } else {
      const {error} = await db.from("playlist_songs").delete().eq("playlist_id",pid).eq("user_id",uid);
      if (error) return bad("No se pudo vaciar la playlist.",500,"reorder_failed",o);
    }
    return ok({playlist_id:pid,song_ids:ids},200,o);
  }
  return bad("Acción de playlist desconocida.",404,"unknown_action",o);
}
async function favorites(uid: string, action: string, p: Payload, o: string | null) {
  if (!db) return bad("Backend no configurado.",503,"backend_unavailable",o);
  if (action === "favorites.list") {
    const {data,error} = await db.from("favorites").select("song_id,created_at").eq("user_id",uid).order("created_at",{ascending:false});
    if (error) return bad("No se pudieron consultar favoritos.",500,"favorites_failed",o);
    return ok({favorites:data ?? []},200,o);
  }
  const sid = text(p.song_id,50);
  if (!uuid(sid)) return bad("Canción inválida.",422,"invalid_song_id",o);
  if (action === "favorites.add") {
    const {data:s} = await db.from("songs").select("id").eq("id",sid).eq("user_id",uid).maybeSingle();
    if (!s) return bad("La canción no te pertenece.",404,"song_not_found",o);
    const {error} = await db.from("favorites").upsert({user_id:uid,song_id:sid},{onConflict:"user_id,song_id",ignoreDuplicates:true});
    if (error) return bad("No se pudo guardar el favorito.",500,"favorite_add_failed",o);
    return ok({song_id:sid,favorite:true},200,o);
  }
  if (action === "favorites.remove") {
    const {error} = await db.from("favorites").delete().eq("user_id",uid).eq("song_id",sid);
    if (error) return bad("No se pudo retirar el favorito.",500,"favorite_remove_failed",o);
    return ok({song_id:sid,favorite:false},200,o);
  }
  return bad("Acción de favoritos desconocida.",404,"unknown_action",o);
}
async function history(uid: string, action: string, p: Payload, o: string | null) {
  if (!db) return bad("Backend no configurado.",503,"backend_unavailable",o);
  if (action === "history.list") {
    const lim = Math.max(1,Math.min(100,Number(p.limit)||50));
    const {data,error} = await db.from("listening_history").select("id,song_id,snapshot_title,snapshot_artist,played_at,listened_seconds,completed").eq("user_id",uid).order("played_at",{ascending:false}).limit(lim);
    if (error) return bad("No se pudo cargar el historial.",500,"history_read_failed",o);
    return ok({history:data ?? []},200,o);
  }
  if (action === "history.add") {
    const sid = text(p.song_id,50) || null, title = text(p.title,250);
    if (!title) return bad("Falta el título de la canción.",422,"invalid_history_item",o);
    if (sid) { const {data:s} = await db.from("songs").select("id").eq("id",sid).eq("user_id",uid).maybeSingle(); if (!s) return bad("La canción no te pertenece.",403,"forbidden_song",o); }
    const {error} = await db.from("listening_history").insert({user_id:uid,song_id:sid,snapshot_title:title,snapshot_artist:text(p.artist,250),listened_seconds:Math.max(0,Math.min(86400,Math.floor(Number(p.listened_seconds)||0))),completed:Boolean(p.completed)});
    if (error) return bad("No se pudo registrar la reproducción.",500,"history_write_failed",o);
    const {data:old} = await db.from("listening_history").select("id").eq("user_id",uid).order("played_at",{ascending:false}).range(500,1000);
    if (old?.length) await db.from("listening_history").delete().eq("user_id",uid).in("id",old.map((x) => x.id));
    return ok({recorded:true},201,o);
  }
  return bad("Acción de historial desconocida.",404,"unknown_action",o);
}
async function settings(uid: string, action: string, p: Payload, o: string | null) {
  if (!db) return bad("Backend no configurado.",503,"backend_unavailable",o);
  if (action === "settings.get") {
    const {data,error} = await db.from("user_settings").select("theme,volume,playback_speed,repeat_mode,shuffle").eq("user_id",uid).maybeSingle();
    if (error) return bad("No se pudieron cargar ajustes.",500,"settings_failed",o);
    return ok({settings:data ?? null},200,o);
  }
  if (action === "settings.update") {
    const ch: Payload = {};
    if (["dark","light","system"].includes(String(p.theme))) ch.theme = p.theme;
    if (p.volume !== undefined) ch.volume = Math.max(0,Math.min(1,Number(p.volume)||0));
    if (p.playback_speed !== undefined) ch.playback_speed = Math.max(0.5,Math.min(2,Number(p.playback_speed)||1));
    if (["off","one","all"].includes(String(p.repeat_mode))) ch.repeat_mode = p.repeat_mode;
    if (p.shuffle !== undefined) ch.shuffle = Boolean(p.shuffle);
    if (!Object.keys(ch).length) return bad("No hay ajustes válidos.",422,"empty_settings",o);
    const {data,error} = await db.from("user_settings").upsert({user_id:uid,...ch},{onConflict:"user_id"}).select("theme,volume,playback_speed,repeat_mode,shuffle").single();
    if (error || !data) return bad("No se pudieron guardar ajustes.",500,"settings_update_failed",o);
    return ok({settings:data},200,o);
  }
  return bad("Acción de ajustes desconocida.",404,"unknown_action",o);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (origin && !originOK(origin)) return new Response("Origin not allowed", { status: 403 });
    return new Response(null, { status: 204, headers: headers(origin) });
  }
  if (req.method !== "POST") return bad("Método no permitido.",405,"method_not_allowed",origin);
  if (origin && !originOK(origin)) return bad("Origen no autorizado. Configura ALLOWED_ORIGINS.",403,"origin_not_allowed",null);
  if (!publicKey || !url || !secretKey) return bad("El backend Supabase no está configurado. Revisa las claves de Edge Functions.",503,"backend_unavailable",origin);
  if (req.headers.get("apikey") !== publicKey) return bad("Clave pública no válida.",401,"invalid_api_key",origin);
  let p: Payload;
  try { const raw = await req.text(); if (raw.length > 1024*1024) return bad("Solicitud demasiado grande.",413,"payload_too_large",origin); const v = JSON.parse(raw); if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(); p = v; }
  catch { return bad("El cuerpo de la solicitud no es válido.",400,"invalid_json",origin); }
  const action = text(p.action,80);
  try {
    if (action === "health") return ok({service:"MUSIC PLAYER",status:"ready",version:"cors-lazy-v4"},200,origin);
    await initializeDb();
    if (action === "auth.register") return await authRegister(p,req,origin);
    if (action === "auth.login") return await authLogin(p,req,origin);
    if (action === "auth.request-reset") return await resetRequest(p,origin);
    if (action === "auth.reset-password") return await resetPassword(p,origin);
    const auth = await currentUser(req);
    if (!auth) return bad("La sesión expiró o no es válida. Inicia sesión nuevamente.",401,"session_invalid",origin);
    const uid = String(auth.user.id);
    if (action === "auth.me") return await authMe(uid,origin,auth.user);
    if (action === "auth.logout") { await db.from("user_sessions").update({revoked_at:new Date().toISOString()}).eq("id",auth.sessionId); return ok({logged_out:true},200,origin); }
    if (action.startsWith("library.")) return await library(uid,action,p,origin);
    if (action.startsWith("playlists.")) return await playlists(uid,action,p,origin);
    if (action.startsWith("favorites.")) return await favorites(uid,action,p,origin);
    if (action.startsWith("history.")) return await history(uid,action,p,origin);
    if (action.startsWith("settings.")) return await settings(uid,action,p,origin);
    return bad("Acción desconocida.",404,"unknown_action",origin);
  } catch (e) {
    console.error("MUSIC PLAYER request failed",e instanceof Error ? e.name : "unknown");
    return bad("Ocurrió un error interno. Inténtalo nuevamente.",500,"internal_error",origin);
  }
});
