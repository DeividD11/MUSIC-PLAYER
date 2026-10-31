import { APP_CONFIG } from '../config/supabase.config.js';

let databasePromise;

function openDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Este navegador no admite almacenamiento local persistente.'));
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(APP_CONFIG.localDatabase, APP_CONFIG.localDatabaseVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('favorites')) db.createObjectStore('favorites', { keyPath: 'song_id' });
        if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir la biblioteca local.'));
      request.onblocked = () => reject(new Error('Cierra otras pestañas de MUSIC PLAYER y vuelve a intentarlo.'));
    });
  }
  return databasePromise;
}

async function transaction(storeNames, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    try { result = operation(tx); }
    catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Error en el almacenamiento local.'));
    tx.onabort = () => reject(tx.error || new Error('La operación local fue cancelada.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class LocalLibraryRepository {
  async getSongs() {
    return requestResult((await openDatabase()).transaction('songs', 'readonly').objectStore('songs').getAll());
  }

  async saveSong(song, fileBlob = null) {
    await transaction(fileBlob ? ['songs', 'audio'] : ['songs'], 'readwrite', (tx) => {
      tx.objectStore('songs').put(song);
      if (fileBlob) tx.objectStore('audio').put({ id: song.id, blob: fileBlob, name: song.original_file_name || '' });
    });
    return song;
  }

  async getAudio(songId) {
    const record = await requestResult((await openDatabase()).transaction('audio', 'readonly').objectStore('audio').get(songId));
    return record?.blob || null;
  }

  async deleteSong(songId) {
    await transaction(['songs', 'audio', 'favorites'], 'readwrite', (tx) => {
      tx.objectStore('songs').delete(songId);
      tx.objectStore('audio').delete(songId);
      tx.objectStore('favorites').delete(songId);
    });
  }

  async getPlaylists() {
    return requestResult((await openDatabase()).transaction('playlists', 'readonly').objectStore('playlists').getAll());
  }

  async savePlaylist(playlist) {
    await transaction(['playlists'], 'readwrite', (tx) => tx.objectStore('playlists').put(playlist));
    return playlist;
  }

  async deletePlaylist(playlistId) {
    await transaction(['playlists'], 'readwrite', (tx) => tx.objectStore('playlists').delete(playlistId));
  }

  async getFavorites() {
    return requestResult((await openDatabase()).transaction('favorites', 'readonly').objectStore('favorites').getAll());
  }

  async setFavorite(songId, favorite) {
    await transaction(['favorites'], 'readwrite', (tx) => {
      if (favorite) tx.objectStore('favorites').put({ song_id: songId, created_at: new Date().toISOString() });
      else tx.objectStore('favorites').delete(songId);
    });
  }

  async addHistory(entry) {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('history', 'readwrite');
      const store = tx.objectStore('history');
      store.add(entry);
      const cursorRequest = store.openCursor(null, 'prev');
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor && cursor.key > 200) store.delete(cursor.key - 200);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async getHistory() {
    const values = await requestResult((await openDatabase()).transaction('history', 'readonly').objectStore('history').getAll());
    return values.sort((a, b) => new Date(b.played_at) - new Date(a.played_at)).slice(0, 200);
  }

  async clearHistory() {
    await transaction(['history'], 'readwrite', (tx) => tx.objectStore('history').clear());
  }

  async storageEstimate() {
    if (!navigator.storage?.estimate) return null;
    try { return await navigator.storage.estimate(); } catch { return null; }
  }
}
