import { SUPABASE_CONFIG } from '../config/supabase.config.js';

let storageClientPromise;

async function getStorageClient() {
  if (!storageClientPromise) {
    storageClientPromise = import('https://esm.sh/@supabase/supabase-js@2.118.0?bundle')
      .then(({ createClient }) => createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }));
  }
  return storageClientPromise;
}

export async function uploadSignedFile(bucket, path, token, file, mimeType) {
  const client = await getStorageClient();
  const { data, error } = await client.storage.from(bucket).uploadToSignedUrl(path, token, file, {
    contentType: mimeType,
    upsert: false,
    cacheControl: '3600',
  });
  if (error) throw new Error(error.message || 'La carga del archivo falló.');
  return data;
}
