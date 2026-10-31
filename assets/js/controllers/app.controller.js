import { ApiClient } from '../services/api-client.js';
import { uploadSignedFile } from '../services/storage-client.js';
import { LocalLibraryRepository } from '../repositories/local-library.repository.js';
import { PlayerModel } from '../models/player.model.js';
import { AppView } from '../views/app.view.js';
import { readAudioTags, titleFromFileName } from '../utils/id3.js';
import { element, toast, formatTime } from '../utils/dom.js';
import { SUPABASE_CONFIG } from '../config/supabase.config.js';

export class AppController {
  constructor() {
    this.repository = new LocalLibraryRepository();
    this.view = new AppView();
    this.player = new PlayerModel(document.getElementById('audio-element'), this.repository);
    this.user = null;
    this.profile = null;
    this.songs = [];
    this.playlists = [];
    this.favorites = new Set();
    this.history = [];
    this.activePanel = 'home';
    this.libraryFilter = 'all';
    this.sortMode = 'recent';
    this.selectedPlaylistId = null;
    this.searchText = '';
    this.remoteOffset = 0;
    this.remoteHasMore = false;
    this.busyImport = false;
    this.settings = { theme: 'dark', volume: 0.8, playback_speed: 1, repeat_mode: 'off', shuffle: false };
    this._bindEvents();
    this._bindPlayer();
  }

  async init() {
    this._applySavedPreferences();
    await this._loadData();
    this.view.showPanel('home');
    this._renderAll();
  }

  _bindEvents() {
    document.addEventListener('click', (event) => this._handleClick(event));
    document.getElementById('global-search').addEventListener('input', (event) => {
      this.searchText = event.target.value.trim().toLocaleLowerCase('es');
      if (this.activePanel !== 'library') this._navigate('library');
      this._renderLibrary();
    });
    document.getElementById('file-input').addEventListener('change', (event) => this._importFiles(event.target.files));
    document.getElementById('hero-import').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('quick-import').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('library-import').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('import-button').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('library-filters').addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter]'); if (!button) return;
      this.libraryFilter = button.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((node) => node.classList.toggle('is-active', node === button));
      this._renderLibrary();
    });
    document.getElementById('sort-select').addEventListener('change', (event) => { this.sortMode = event.target.value; this._renderLibrary(); });
    document.getElementById('load-more').addEventListener('click', () => this._loadMoreSongs().catch((error) => toast(error.message, 'error')));
    document.getElementById('playlist-form').addEventListener('submit', (event) => this._createPlaylist(event));
    document.getElementById('player-favorite').addEventListener('click', () => { if (this.player.currentTrack) this._toggleFavorite(this.player.currentTrack).catch((error) => toast(error.message, 'error')); });
    document.getElementById('play-toggle').addEventListener('click', () => this.player.togglePlay().catch((error) => toast(error.message, 'error')));
    document.getElementById('previous-track').addEventListener('click', () => this.player.previous().catch((error) => toast(error.message, 'error')));
    document.getElementById('next-track').addEventListener('click', () => this.player.next().catch((error) => toast(error.message, 'error')));
    document.getElementById('progress-range').addEventListener('input', (event) => this.player.seek(Number(event.target.value) / 1000));
    document.getElementById('volume-range').addEventListener('input', (event) => {
      this.player.setVolume(event.target.value); this.settings.volume = Number(event.target.value);
      document.getElementById('setting-volume').value = event.target.value;
    });
    document.getElementById('mute-toggle').addEventListener('click', () => this.player.toggleMute());
    document.getElementById('shuffle-toggle').addEventListener('click', () => { this.player.toggleShuffle(); this.settings.shuffle = this.player.shuffle; });
    document.getElementById('repeat-toggle').addEventListener('click', () => { this.player.cycleRepeat(); this.settings.repeat_mode = this.player.repeat; });
    document.getElementById('queue-toggle').addEventListener('click', () => this._toggleQueue(true));
    document.getElementById('queue-close').addEventListener('click', () => this._toggleQueue(false));
    document.getElementById('queue-clear').addEventListener('click', () => { this.player.clearQueue(); toast('Cola vaciada.'); });
    document.getElementById('account-action').addEventListener('click', () => { if (!this.user) window.location.href = './login.html'; });
    document.getElementById('settings-logout').addEventListener('click', () => this._logout());
    document.getElementById('save-settings').addEventListener('click', () => this._saveSettings());
    document.getElementById('setting-volume').addEventListener('input', (event) => {
      document.getElementById('volume-range').value = event.target.value;
      this.player.setVolume(event.target.value);
    });
    document.getElementById('clear-history').addEventListener('click', async () => {
      if (!window.confirm('¿Limpiar el historial guardado en este dispositivo?')) return;
      await this.repository.clearHistory(); this.history = await this.repository.getHistory(); this._renderHistory(); this._renderCounts(); toast('Historial local limpiado.');
    });
    document.getElementById('mobile-menu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('is-open'));
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.getElementById('global-search').focus(); }
      if (event.key === 'Escape') { this._toggleQueue(false); document.getElementById('sidebar').classList.remove('is-open'); }
    });
    const appShell = document.getElementById('content-scroll');
    appShell.addEventListener('dragover', (event) => { event.preventDefault(); });
    appShell.addEventListener('drop', (event) => {
      event.preventDefault(); const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith('audio/'));
      if (files.length) this._importFiles(files);
    });
  }

  _bindPlayer() {
    this.player.addEventListener('trackchange', (event) => {
      const song = event.detail.track;
      this.view.setPlayerTrack(song);
      this._recordPlay(song);
    });
    this.player.addEventListener('state', (event) => this.view.setPlayState(event.detail.playing));
    this.player.addEventListener('progress', (event) => this.view.setProgress(event.detail));
    this.player.addEventListener('queue', (event) => this.view.renderQueue(event.detail.queue, event.detail.currentIndex));
    this.player.addEventListener('modes', (event) => this.view.setModes(event.detail));
    this.player.addEventListener('settings', (event) => {
      const { volume, muted } = event.detail;
      if (volume !== undefined) document.getElementById('volume-range').value = muted ? 0 : volume;
      document.getElementById('mute-toggle').textContent = muted || volume === 0 ? '◖×' : '◖))';
      if (event.detail.speed !== undefined) document.getElementById('setting-speed').value = String(event.detail.speed);
    });
    this.player.addEventListener('error', (event) => toast(event.detail.message, 'error'));
  }

  async _loadData() {
    const localSongs = await this.repository.getSongs().catch(() => []);
    const localPlaylists = await this.repository.getPlaylists().catch(() => []);
    const localFavorites = await this.repository.getFavorites().catch(() => []);
    const localHistory = await this.repository.getHistory().catch(() => []);
    this.songs = [...localSongs];
    this.playlists = localPlaylists.map((item) => ({ ...item, items: (item.song_ids || []).map((song_id) => ({ song_id })) }));
    this.favorites = new Set(localFavorites.map((item) => item.song_id));
    this.history = localHistory;

    if (ApiClient.token) {
      try {
        const me = await ApiClient.call('auth.me');
        this.user = me.user;
        this.profile = me.profile;
        if (me.settings) this.settings = { ...this.settings, ...me.settings };
        const [remoteSongs, remoteLists, remoteFavorites, remoteHistory] = await Promise.all([
          ApiClient.call('library.list', { limit: 100, offset: 0 }),
          ApiClient.call('playlists.list'),
          ApiClient.call('favorites.list'),
          ApiClient.call('history.list', { limit: 100 }),
        ]);
        const remoteIds = new Set(remoteSongs.songs.map((song) => song.id));
        this.songs = remoteSongs.songs;
        this.remoteOffset = remoteSongs.offset || 0;
        this.remoteHasMore = Boolean(remoteSongs.has_more);
        // Keep device-local tracks local. Never create remote metadata rows implicitly.
        const remoteById = new Map(remoteSongs.songs.map((song) => [song.id, song]));
        this.songs = [...remoteSongs.songs, ...localSongs.filter((song) => !remoteById.has(song.id))];
        for (const localSong of localSongs) {
          const remote = remoteById.get(localSong.id);
          if (remote) await this.repository.saveSong({ ...localSong, ...remote, source_type: remote.source_type });
        }
        this.playlists = remoteLists.playlists;
        const knownPlaylistIds = new Set(this.playlists.map((item) => item.id));
        for (const localList of localPlaylists) {
          if (!knownPlaylistIds.has(localList.id)) {
            try {
              const result = await ApiClient.call('playlists.create', { id: localList.id, name: localList.name, description: localList.description || '' });
              const synced = { ...result.playlist, items: [] };
              for (const songId of localList.song_ids || []) {
                if (this.songs.some((song) => song.id === songId)) {
                  await ApiClient.call('playlists.add-song', { playlist_id: synced.id, song_id: songId });
                  synced.items.push({ song_id: songId });
                }
              }
              this.playlists.push(synced);
            } catch { this.playlists.push({ ...localList, items: (localList.song_ids || []).map((song_id) => ({ song_id })) }); }
          }
        }
        this.favorites = new Set(remoteFavorites.favorites.map((item) => item.song_id));
        for (const localFavorite of localFavorites) {
          if (!this.favorites.has(localFavorite.song_id) && this.songs.some((song) => song.id === localFavorite.song_id)) {
            try { await ApiClient.call('favorites.add', { song_id: localFavorite.song_id }); this.favorites.add(localFavorite.song_id); } catch { /* kept locally */ }
          }
        }
        this.history = remoteHistory.history.map((item) => ({ ...item, title: item.snapshot_title, artist: item.snapshot_artist }));
        toast('Cuenta sincronizada.', 'success');
      } catch (error) {
        if (error.status === 401) ApiClient.clearSession();
        this.user = null;
        toast(error.message || 'No se pudo sincronizar. Se mostrará la biblioteca local.', 'error');
      }
    }

    this.view.showAccount(this.user);
    this.player.setVolume(Number(this.settings.volume ?? 0.8));
    this.player.setSpeed(Number(this.settings.playback_speed ?? 1));
    this.player.shuffle = Boolean(this.settings.shuffle);
    this.player.repeat = this.settings.repeat_mode || 'off';
    this.view.setModes({ shuffle: this.player.shuffle, repeat: this.player.repeat });
    document.getElementById('volume-range').value = this.settings.volume ?? 0.8;
    document.getElementById('setting-volume').value = this.settings.volume ?? 0.8;
    document.getElementById('setting-speed').value = String(this.settings.playback_speed ?? 1);
    document.getElementById('setting-theme').value = this.settings.theme || 'dark';
  }

  _applySavedPreferences() {
    try {
      const prefs = JSON.parse(localStorage.getItem('mp_preferences') || '{}');
      this.settings = { ...this.settings, ...prefs };
      document.documentElement.dataset.theme = this.settings.theme === 'light' ? 'light' : 'dark';
    } catch { document.documentElement.dataset.theme = 'dark'; }
  }

  _renderAll() {
    this.songs = this.songs.map((song) => ({ ...song, is_favorite: this.favorites.has(song.id) }));
    this.view.renderCounts({ songs: this.songs.length, playlists: this.playlists.length, favorites: this.favorites.size, history: this.history.length });
    this.view.renderHome(this.songs, this.user);
    this._renderLibrary();
    this._renderPlaylists();
    this._renderFavorites();
    this._renderHistory();
    this.view.renderQueue(this.player.queue, this.player.currentIndex);
  }

  _renderCounts() { this.view.renderCounts({ songs: this.songs.length, playlists: this.playlists.length, favorites: this.favorites.size, history: this.history.length }); }

  _navigate(panel) {
    if (!this.view.panelTitles[panel]) return;
    this.activePanel = panel; this.view.showPanel(panel);
  }

  _renderLibrary() {
    const searchFiltered = this.searchText ? this.songs.filter((song) => `${song.title} ${song.artist} ${song.album} ${song.genre}`.toLocaleLowerCase('es').includes(this.searchText)) : this.songs;
    this.view.renderLibrary(searchFiltered, this.libraryFilter, this.sortMode, this.user);
    document.getElementById('load-more').classList.toggle('hidden', !this.user || !this.remoteHasMore || this.libraryFilter !== 'all' || Boolean(this.searchText));
  }

  async _loadMoreSongs() {
    if (!this.user || !this.remoteHasMore) return;
    const button = document.getElementById('load-more');
    button.disabled = true; button.textContent = 'Cargando…';
    try {
      const next = await ApiClient.call('library.list', { limit: 100, offset: this.remoteOffset + 100 });
      this.songs = this._uniqueById([...this.songs, ...next.songs]);
      this.remoteOffset = next.offset || this.remoteOffset + 100;
      this.remoteHasMore = Boolean(next.has_more);
      this._renderAll();
    } finally { button.disabled = false; button.textContent = 'Cargar más'; }
  }

  _renderPlaylists() { this.view.renderPlaylists(this.playlists, this.songs, this.selectedPlaylistId); }
  _renderFavorites() { this.view.renderSongList(document.getElementById('favorites-list'), this.songs.filter((song) => this.favorites.has(song.id)), { user: this.user }); }
  _renderHistory() { this.view.renderHistory(this.history); }

  async _handleClick(event) {
    const nav = event.target.closest('[data-nav]');
    if (nav) { this._navigate(nav.dataset.nav); return; }
    const actionNode = event.target.closest('[data-action]');
    if (!actionNode) return;
    const action = actionNode.dataset.action;
    const song = actionNode.dataset.songId ? this.songs.find((item) => item.id === actionNode.dataset.songId) : null;
    try {
      if (action === 'import') { document.getElementById('file-input').click(); return; }
      if (action === 'play' && song) { await this._playSong(song); return; }
      if (action === 'queue' && song) { this.player.addToQueue(song); toast(`Añadida al final de la cola: ${song.title}`); return; }
      if (action === 'play-next' && song) { this.player.addToQueue(song, true); toast(`Se reproducirá a continuación: ${song.title}`); return; }
      if (action === 'favorite' && song) { await this._toggleFavorite(song); return; }
      if (action === 'playlist-add' && song) { await this._addToFirstPlaylist(song); return; }
      if (action === 'upload' && song) { await this._uploadSong(song); return; }
      if (action === 'delete-song' && song) { await this._deleteSong(song); return; }
      if (action === 'delete-cloud-song' && song) { await this._deleteCloudSong(song); return; }
      if (action === 'edit-song' && song) { await this._editSong(song); return; }
      if (action === 'open-playlist') { this.selectedPlaylistId = actionNode.dataset.playlistId; this._renderPlaylists(); return; }
      if (action === 'play-playlist') { const list = this.playlists.find((item) => item.id === actionNode.dataset.playlistId); await this._playPlaylist(list); return; }
      if (action === 'delete-playlist') { await this._deletePlaylist(actionNode.dataset.playlistId); return; }
      if (action === 'rename-playlist') { await this._renamePlaylist(actionNode.dataset.playlistId); return; }
      if (action === 'move-playlist-song') { await this._movePlaylistSong(actionNode.dataset.songId, actionNode.dataset.direction); return; }
      if (action === 'remove-from-playlist') { await this._removeFromPlaylist(actionNode.dataset.songId, actionNode.closest('#playlist-detail') ? this.selectedPlaylistId : null); return; }
      if (action === 'play-queue-item') { const index = Number(actionNode.dataset.queueIndex); const item = this.player.queue[index]; if (item) await this._playSong(item, this.player.queue); return; }
      if (action === 'move-queue-item') { const index = Number(actionNode.dataset.queueIndex); this.player.moveInQueue(index, index + (actionNode.dataset.direction === 'up' ? -1 : 1)); return; }
      if (action === 'remove-queue-item') { this.player.removeFromQueue(Number(actionNode.dataset.queueIndex)); return; }
    } catch (error) { toast(error.message || 'No se pudo completar la acción.', 'error'); }
  }

  async _playSong(song, queue = this.songs) {
    let track = song;
    let playableQueue = [...queue];
    if (this.user) {
      if (song.source_type === 'storage') {
        const fresh = await ApiClient.call('library.refresh-url', { id: song.id });
        track = { ...song, audio_url: fresh.audio_url, cover_url: fresh.cover_url };
      }
      playableQueue = playableQueue.map((item) => item.id === track.id ? track : item);
    } else {
      const resolved = [];
      for (const item of playableQueue) {
        if (item.source_type === 'storage') {
          const blob = await this.repository.getAudio(item.id);
          if (blob) resolved.push({ ...item, source_type: 'local', audio_url: null });
        } else resolved.push(item);
      }
      playableQueue = resolved;
      track = playableQueue.find((item) => item.id === song.id);
      if (!track) throw new Error('Inicia sesión para reproducir esta canción almacenada en la nube.');
    }
    this.player.setQueue(playableQueue, track.id);
    await this.player.playTrack(track);
    this.view.renderQueue(this.player.queue, this.player.currentIndex);
  }

  async _recordPlay(song) {
    const entry = { title: song.title, artist: song.artist || '', song_id: song.id, played_at: new Date().toISOString(), listened_seconds: 0 };
    await this.repository.addHistory(entry).catch(() => {});
    if (this.user) {
      ApiClient.call('history.add', { song_id: song.id, title: song.title, artist: song.artist, listened_seconds: 0, completed: false }).catch(() => {});
      if (song.source_type === 'storage') ApiClient.call('library.refresh-url', { id: song.id }).then((urls) => {
        if (urls.cover_url && this.player.currentTrack?.id === song.id) {
          song.cover_url = urls.cover_url;
          this.view.setPlayerTrack(song);
        }
      }).catch(() => {});
    }
    this.history.unshift(entry); this.history = this.history.slice(0, 200);
    this._renderHistory(); this._renderCounts();
  }

  async _toggleFavorite(song) {
    const next = !this.favorites.has(song.id);
    await this.repository.setFavorite(song.id, next);
    if (this.user) {
      if (next) await ApiClient.call('favorites.add', { song_id: song.id });
      else await ApiClient.call('favorites.remove', { song_id: song.id });
    }
    if (next) this.favorites.add(song.id); else this.favorites.delete(song.id);
    if (this.player.currentTrack?.id === song.id) {
      this.player.currentTrack.is_favorite = next;
      this.view.setPlayerTrack(this.player.currentTrack);
    }
    this._renderAll(); toast(next ? 'Añadida a favoritos.' : 'Retirada de favoritos.');
  }

  async _importFiles(fileList) {
    if (this.busyImport || !fileList?.length) return;
    this.busyImport = true;
    const input = document.getElementById('file-input');
    try {
      for (const file of [...fileList]) {
        const probe = document.createElement('audio');
        const canPlay = file.type.startsWith('audio/') && Boolean(probe.canPlayType(file.type));
        if (!canPlay) { toast(`Formato no compatible: ${file.name}`, 'error'); continue; }
        if (file.size > 100 * 1024 * 1024) { toast(`${file.name}: supera el límite de 100 MB.`, 'error'); continue; }
        const estimate = await this.repository.storageEstimate();
        if (estimate?.quota && estimate.usage + file.size > estimate.quota * 0.92) { toast('El almacenamiento local disponible es insuficiente. Libera espacio o sube archivos a la nube.', 'error'); continue; }
        const tags = await readAudioTags(file).catch(() => ({}));
        const duration = await this._readDuration(file);
        const id = crypto.randomUUID();
        let song = {
          id,
          title: titleFromFileName(file.name),
          artist: tags.artist || '', album: tags.album || '', genre: tags.genre || '',
          duration_seconds: duration || null, source_type: 'local', audio_path: null, cover_path: null,
          mime_type: file.type, file_size_bytes: file.size, original_file_name: file.name,
          metadata: tags, created_at: new Date().toISOString(),
        };
        if (this.user) {
          try {
            const result = await ApiClient.call('library.create', {
              id, title: song.title, artist: song.artist, album: song.album, genre: song.genre,
              duration_seconds: song.duration_seconds, source_type: 'local', mime_type: song.mime_type,
              file_size_bytes: song.file_size_bytes, original_file_name: song.original_file_name, metadata: tags,
            });
            song = { ...result.song, source_type: 'local' };
          } catch (error) { toast(`${file.name}: guardada solo localmente (${error.message})`, 'error'); }
        }
        await this.repository.saveSong(song, file);
        this.songs.unshift(song);
      }
      this.songs = this._uniqueById(this.songs);
      this._renderAll();
      if (this.songs.length) this._navigate('library');
      toast('Importación terminada.', 'success');
    } catch (error) {
      toast(error.message || 'No fue posible importar los archivos.', 'error');
    } finally {
      input.value = '';
      this.busyImport = false;
    }
  }

  _readDuration(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const audio = document.createElement('audio');
      audio.preload = 'metadata'; audio.src = url;
      const finish = (value) => { URL.revokeObjectURL(url); audio.removeAttribute('src'); audio.load(); resolve(value); };
      audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? Math.floor(audio.duration) : 0);
      audio.onerror = () => finish(0);
    });
  }

  _uniqueById(items) { return [...new Map(items.map((item) => [item.id, item])).values()]; }

  async _uploadSong(song) {
    if (!this.user) throw new Error('Inicia sesión para subir archivos a tu almacenamiento privado.');
    const blob = await this.repository.getAudio(song.id);
    if (!blob) throw new Error('El archivo local ya no está disponible.');
    // Create only the selected track's remote metadata before uploading its binary.
    if (song.source_type !== 'storage') {
      const created = await ApiClient.call('library.create', {
        id: song.id, title: song.title, artist: song.artist || '', album: song.album || '',
        genre: song.genre || '', duration_seconds: song.duration_seconds || null,
        source_type: 'local', mime_type: song.mime_type || blob.type,
        file_size_bytes: blob.size, original_file_name: song.original_file_name || '',
        metadata: song.metadata || {},
      });
      Object.assign(song, created.song);
      song.source_type = 'local';
    }
    const upload = await ApiClient.call('library.upload-url', {
      kind: 'audio', file_name: song.original_file_name || `${song.title}.audio`,
      mime_type: song.mime_type || blob.type, file_size_bytes: blob.size,
    });
    await uploadSignedFile(upload.bucket, upload.path, upload.token, blob, song.mime_type || blob.type);
    const attached = await ApiClient.call('library.attach-files', {
      id: song.id, audio_path: upload.path, mime_type: song.mime_type || blob.type, file_size_bytes: blob.size,
    });
    Object.assign(song, attached.song);
    song.source_type = 'storage';
    await this.repository.saveSong(song);
    this._renderAll();
    toast('Canción subida y vinculada a tu cuenta.', 'success');
  }

  async _deleteCloudSong(song) {
    if (!this.user || song.source_type !== 'storage') throw new Error('Esta canción no está guardada en la nube.');
    if (!window.confirm(`¿Eliminar “${song.title}” del almacenamiento en la nube? Se conservará el archivo local si existe.`)) return;
    await ApiClient.call('library.delete', { id: song.id });
    const localBlob = await this.repository.getAudio(song.id).catch(() => null);
    if (localBlob) {
      song.source_type = 'local'; song.audio_path = null;
      await this.repository.saveSong(song);
    } else {
      await this.repository.deleteSong(song.id);
      this.songs = this.songs.filter((item) => item.id !== song.id);
    }
    this._renderAll();
    toast('Eliminada de la nube.', 'success');
  }

  async _deleteSong(song) {
    if (!window.confirm(`¿Eliminar “${song.title}” de tu biblioteca?`)) return;
    if (this.user) await ApiClient.call('library.delete', { id: song.id });
    await this.repository.deleteSong(song.id);
    this.songs = this.songs.filter((item) => item.id !== song.id);
    this.favorites.delete(song.id);
    if (this.player.currentTrack?.id === song.id) { this.player.audio.pause(); this.player.currentTrack = null; this.view.setPlayerTrack(null); this.view.setPlayState(false); }
    for (const list of this.playlists) {
      list.items = (list.items || []).filter((item) => item.song_id !== song.id);
      list.song_ids = (list.song_ids || []).filter((id) => id !== song.id);
    }
    this._renderAll(); toast('Canción eliminada de la biblioteca.');
  }

  async _editSong(song) {
    const title = window.prompt('Título de la canción:', song.title);
    if (title === null) return;
    const artist = window.prompt('Artista:', song.artist || '');
    if (artist === null) return;
    const album = window.prompt('Álbum:', song.album || '');
    if (album === null) return;
    const genre = window.prompt('Género:', song.genre || '');
    if (genre === null) return;
    const changes = { title: title.trim(), artist: artist.trim(), album: album.trim(), genre: genre.trim() };
    if (!changes.title) throw new Error('El título no puede quedar vacío.');
    if (this.user) await ApiClient.call('library.update', { id: song.id, ...changes });
    Object.assign(song, changes);
    await this.repository.saveSong(song);
    this._renderAll(); toast('Información actualizada.', 'success');
  }

  async _createPlaylist(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.elements.name.value.trim();
    const description = form.elements.description.value.trim();
    if (!name) return;
    try {
      let playlist = { id: crypto.randomUUID(), name, description, created_at: new Date().toISOString(), song_ids: [], items: [] };
      if (this.user) {
        const result = await ApiClient.call('playlists.create', { id: playlist.id, name, description });
        playlist = { ...result.playlist, song_ids: [], items: [] };
      }
      await this.repository.savePlaylist({ id: playlist.id, name, description, created_at: playlist.created_at, song_ids: [] });
      this.playlists.unshift(playlist); form.reset(); this._renderAll(); toast('Playlist creada.', 'success');
    } catch (error) { toast(error.message, 'error'); }
  }

  async _addToFirstPlaylist(song) {
    if (!this.playlists.length) {
      const name = window.prompt('Nombre de la nueva playlist:', 'Mis canciones');
      if (!name?.trim()) return;
      let playlist = { id: crypto.randomUUID(), name: name.trim(), description: '', created_at: new Date().toISOString(), items: [], song_ids: [] };
      if (this.user) {
        const result = await ApiClient.call('playlists.create', { id: playlist.id, name: playlist.name, description: '' });
        playlist = { ...result.playlist, items: [], song_ids: [] };
      }
      this.playlists.unshift(playlist);
    }
    let playlist = this.playlists[0];
    if (this.playlists.length > 1) {
      const choices = this.playlists.map((item, index) => `${index + 1}. ${item.name}`).join('\n');
      const selected = Number(window.prompt(`¿A qué playlist deseas agregarla?\n${choices}\nEscribe el número:`, '1')) - 1;
      if (!Number.isInteger(selected) || selected < 0 || selected >= this.playlists.length) return;
      playlist = this.playlists[selected];
    }
    if ((playlist.items || []).some((item) => item.song_id === song.id) || (playlist.song_ids || []).includes(song.id)) {
      toast('La canción ya está en esa playlist.'); return;
    }
    if (this.user) await ApiClient.call('playlists.add-song', { playlist_id: playlist.id, song_id: song.id });
    playlist.items = [...(playlist.items || []), { song_id: song.id, position: (playlist.items || []).length }];
    playlist.song_ids = [...(playlist.song_ids || []), song.id];
    await this.repository.savePlaylist({ id: playlist.id, name: playlist.name, description: playlist.description || '', song_ids: playlist.items.map((item) => item.song_id) });
    this._renderPlaylists(); this._renderCounts(); toast(`Añadida a “${playlist.name}”.`, 'success');
  }

  async _playPlaylist(playlist) {
    if (!playlist) return;
    const ids = playlist.items?.map((item) => item.song_id) || playlist.song_ids || [];
    const tracks = ids.map((id) => this.songs.find((song) => song.id === id)).filter(Boolean);
    if (!tracks.length) throw new Error('Esta playlist todavía no tiene canciones.');
    await this._playSong(tracks[0], tracks);
    this._navigate('playlists');
  }

  async _renamePlaylist(playlistId) {
    const playlist = this.playlists.find((item) => item.id === playlistId);
    if (!playlist) return;
    const name = window.prompt('Nuevo nombre para la playlist:', playlist.name);
    if (name === null) return;
    const normalized = name.trim();
    if (!normalized) throw new Error('El nombre de la playlist no puede quedar vacío.');
    if (this.user) await ApiClient.call('playlists.update', { id: playlistId, name: normalized });
    playlist.name = normalized;
    await this.repository.savePlaylist({ id: playlist.id, name: playlist.name, description: playlist.description || '', song_ids: (playlist.items || []).map((item) => item.song_id) });
    this._renderPlaylists();
    toast('Playlist actualizada.', 'success');
  }

  async _movePlaylistSong(songId, direction) {
    const playlist = this.playlists.find((item) => item.id === this.selectedPlaylistId);
    if (!playlist) return;
    const ids = (playlist.items || []).map((item) => item.song_id);
    const from = ids.indexOf(songId);
    const to = from + (direction === 'up' ? -1 : 1);
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    const previousItems = new Map((playlist.items || []).map((item) => [item.song_id, item]));
    playlist.items = ids.map((id, position) => ({ ...(previousItems.get(id) || {}), song_id: id, position }));
    playlist.song_ids = ids;
    if (this.user) await ApiClient.call('playlists.reorder', { playlist_id: playlist.id, song_ids: ids });
    await this.repository.savePlaylist({ id: playlist.id, name: playlist.name, description: playlist.description || '', song_ids: ids });
    this._renderPlaylists();
  }

  async _deletePlaylist(playlistId) {
    const playlist = this.playlists.find((item) => item.id === playlistId);
    if (!playlist || !window.confirm(`¿Eliminar la playlist “${playlist.name}”?`)) return;
    if (this.user) await ApiClient.call('playlists.delete', { id: playlistId });
    await this.repository.deletePlaylist(playlistId);
    this.playlists = this.playlists.filter((item) => item.id !== playlistId);
    if (this.selectedPlaylistId === playlistId) this.selectedPlaylistId = null;
    this._renderAll(); toast('Playlist eliminada.');
  }

  async _removeFromPlaylist(songId, playlistId) {
    const playlist = this.playlists.find((item) => item.id === playlistId);
    if (!playlist) return;
    if (this.user) await ApiClient.call('playlists.remove-song', { playlist_id: playlistId, song_id: songId });
    playlist.items = (playlist.items || []).filter((item) => item.song_id !== songId);
    playlist.song_ids = (playlist.song_ids || []).filter((id) => id !== songId);
    await this.repository.savePlaylist({ id: playlist.id, name: playlist.name, description: playlist.description, song_ids: playlist.items.map((item) => item.song_id) });
    this._renderPlaylists();
  }

  async _saveSettings() {
    const settings = {
      theme: document.getElementById('setting-theme').value,
      volume: Number(document.getElementById('setting-volume').value),
      playback_speed: Number(document.getElementById('setting-speed').value),
      repeat_mode: this.player.repeat,
      shuffle: this.player.shuffle,
    };
    this.settings = { ...this.settings, ...settings };
    localStorage.setItem('mp_preferences', JSON.stringify(this.settings));
    document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
    this.player.setVolume(settings.volume); this.player.setSpeed(settings.playback_speed);
    if (this.user) await ApiClient.call('settings.update', settings);
    toast('Preferencias guardadas.', 'success');
  }

  async _logout() {
    try { await ApiClient.call('auth.logout'); } catch { /* local logout still revokes the browser token */ }
    ApiClient.clearSession();
    this.player.destroy();
    window.location.href = './login.html';
  }

  _toggleQueue(open) {
    const drawer = document.getElementById('queue-drawer');
    drawer.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', String(!open));
  }
}
