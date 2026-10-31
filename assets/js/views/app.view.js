import { element, formatTime, safeDate } from '../utils/dom.js';

function cover(song, className = 'song-cover') {
  const node = element('div', `cover-art ${className}`, song?.cover_url ? '' : '♫');
  if (song?.cover_url) {
    const image = element('img');
    image.src = song.cover_url;
    image.alt = `Portada de ${song.title || 'la canción'}`;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.onerror = () => { image.remove(); node.textContent = '♫'; };
    node.append(image);
  }
  return node;
}

function actionButton(action, song, label, symbol, extra = {}) {
  const button = element('button', `song-action ${extra.className || ''}`, symbol);
  button.type = 'button';
  button.dataset.action = action;
  if (song?.id) button.dataset.songId = song.id;
  button.setAttribute('aria-label', label);
  button.title = label;
  if (extra.disabled) button.disabled = true;
  return button;
}

export class AppView {
  constructor() {
    this.panelTitles = {
      home: 'Inicio', library: 'Mi biblioteca', playlists: 'Playlists',
      favorites: 'Favoritos', history: 'Historial', settings: 'Configuración',
    };
  }

  showPanel(panel) {
    document.querySelectorAll('[data-panel]').forEach((node) => node.classList.toggle('is-visible', node.dataset.panel === panel));
    document.querySelectorAll('[data-nav]').forEach((node) => {
      if (node.classList.contains('nav-item')) node.classList.toggle('is-active', node.dataset.nav === panel);
    });
    document.getElementById('page-heading').textContent = this.panelTitles[panel] || 'Inicio';
    document.getElementById('sidebar')?.classList.remove('is-open');
  }

  showAccount(user) {
    const username = document.getElementById('sidebar-username');
    const email = document.getElementById('sidebar-email');
    const action = document.getElementById('account-action');
    username.textContent = user?.username || 'Modo local';
    email.textContent = user?.email || 'Biblioteca de este dispositivo';
    action.textContent = user ? '•' : '↗';
    action.setAttribute('aria-label', user ? 'Cuenta conectada' : 'Iniciar sesión');
    action.title = user ? 'Cuenta conectada' : 'Iniciar sesión';
    document.getElementById('settings-account-title').textContent = user ? `Conectado como ${user.username}` : 'Modo local';
    document.getElementById('settings-account-copy').textContent = user
      ? 'Tu cuenta sincroniza metadatos, playlists, favoritos e historial. Los archivos locales solo estarán disponibles en este dispositivo hasta que los subas a Storage.'
      : 'Tus datos y archivos se conservan en este navegador. Inicia sesión para sincronizar metadatos y listas entre dispositivos.';
    document.getElementById('settings-login-link').classList.toggle('hidden', Boolean(user));
    document.getElementById('settings-logout').classList.toggle('hidden', !user);
    document.getElementById('library-status').textContent = user ? 'Cuenta sincronizada' : 'Biblioteca local';
  }

  renderCounts({ songs = 0, playlists = 0, favorites = 0, history = 0 }) {
    document.getElementById('stat-songs').textContent = songs;
    document.getElementById('stat-playlists').textContent = playlists;
    document.getElementById('stat-favorites').textContent = favorites;
    document.getElementById('stat-history').textContent = history;
    document.getElementById('library-count').textContent = songs;
  }

  renderSongList(container, songs, { compact = false, allowDelete = false, playlistId = null, user = null, allowPlaylistAdd = false, allowReorder = false } = {}) {
    container.replaceChildren();
    container.classList.toggle('compact-list', compact);
    if (!songs.length) {
      const empty = element('div', 'empty-state');
      empty.append(element('div', 'empty-state-icon', '♫'));
      empty.append(element('h3', ' ', 'Todavía no hay canciones aquí'));
      empty.append(element('p', '', 'Importa archivos de audio compatibles para empezar a crear tu colección.'));
      const button = element('button', 'button button-primary', '＋ Importar música');
      button.type = 'button'; button.dataset.action = 'import';
      empty.append(button); container.append(empty); return;
    }
    songs.forEach((song, songIndex) => {
      const row = element('article', 'song-row');
      const main = element('div', 'song-main');
      main.append(cover(song));
      const copy = element('div', 'song-copy');
      copy.append(element('strong', '', song.title || 'Sin título'));
      copy.append(element('small', '', song.artist || 'Artista desconocido'));
      main.append(copy);
      const album = element('div', 'song-album', song.album || '—');
      const source = song.source_type === 'storage' ? 'Almacenada en la nube' : 'Solo este dispositivo';
      const origin = element('div', 'song-origin', compact ? '' : source);
      const duration = element('div', 'song-duration', formatTime(song.duration_seconds || 0));
      const actions = element('div', 'song-actions');
      const play = actionButton('play', song, 'Reproducir', '▶');
      play.classList.add('play-row-button');
      const queue = actionButton('queue', song, 'Añadir al final de la cola', '+');
      const playNext = actionButton('play-next', song, 'Reproducir a continuación', '↥');
      const favorite = actionButton('favorite', song, song.is_favorite ? 'Quitar de favoritos' : 'Añadir a favoritos', song.is_favorite ? '♥' : '♡', { className: song.is_favorite ? 'is-favorite' : '' });
      actions.append(play, queue, playNext, favorite);
      if (allowPlaylistAdd) actions.append(actionButton('playlist-add', song, 'Agregar a una playlist', '▦'));
      if (user && song.source_type === 'local') actions.append(actionButton('upload', song, 'Subir a tu almacenamiento privado', '☁'));
      if (allowReorder && playlistId) {
        const up = actionButton('move-playlist-song', song, 'Mover canción hacia arriba', '↑', { disabled: songIndex === 0 });
        up.dataset.direction = 'up';
        const down = actionButton('move-playlist-song', song, 'Mover canción hacia abajo', '↓', { disabled: songIndex === songs.length - 1 });
        down.dataset.direction = 'down';
        actions.append(up, down);
      }
      if (playlistId) actions.append(actionButton('remove-from-playlist', song, 'Retirar de esta playlist', '−', { className: 'subtle-action' }));
      if (allowDelete) actions.append(actionButton('edit-song', song, 'Editar información', '✎'));
      if (allowDelete) actions.append(actionButton('delete-song', song, 'Eliminar canción', '×'));
      row.append(main, album, origin, duration, actions);
      main.dataset.action = 'play'; main.dataset.songId = song.id; main.classList.add('clickable-song');
      container.append(row);
    });
  }

  renderHome(songs, user) {
    const recent = [...songs].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 5);
    this.renderSongList(document.getElementById('home-recent-list'), recent, { compact: true, user });
  }

  renderLibrary(songs, filter, sort, user) {
    let result = [...songs];
    if (filter !== 'all') result = result.filter((song) => song.source_type === filter);
    if (sort === 'title') result.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'es'));
    else if (sort === 'artist') result.sort((a, b) => (a.artist || '').localeCompare(b.artist || '', 'es'));
    else result.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    this.renderSongList(document.getElementById('library-list'), result, { allowDelete: true, user, allowPlaylistAdd: true });
  }

  renderPlaylists(playlists, songs, selectedId = null) {
    const grid = document.getElementById('playlist-grid');
    const detail = document.getElementById('playlist-detail');
    grid.replaceChildren(); detail.classList.add('hidden'); detail.replaceChildren();
    if (!playlists.length) {
      const empty = element('div', 'empty-state');
      empty.append(element('div', 'empty-state-icon', '▦'), element('h3', '', 'Crea tu primera playlist'), element('p', '', 'Agrupa canciones para cada actividad, estado de ánimo o momento.'));
      grid.append(empty); return;
    }
    for (const playlist of playlists) {
      const card = element('article', 'playlist-card');
      const ids = playlist.items?.map((item) => item.song_id) || playlist.song_ids || [];
      const tracks = ids.map((id) => songs.find((song) => song.id === id)).filter(Boolean);
      const art = element('div', 'playlist-art', '♫');
      if (tracks[0]?.cover_url) {
        const image = element('img'); image.src = tracks[0].cover_url; image.alt = `Portada de ${playlist.name}`; image.loading = 'lazy'; art.replaceChildren(image);
      }
      const title = element('h3', '', playlist.name);
      const count = ids.length;
      const totalSeconds = tracks.reduce((sum, song) => sum + (Number(song.duration_seconds) || 0), 0);
      const durationText = totalSeconds ? ` · ${formatTime(totalSeconds)}` : '';
      const description = element('p', '', `${count} canciones${durationText}${playlist.description ? ` · ${playlist.description}` : ''}`);
      const actions = element('div', 'playlist-card-actions');
      const open = element('button', 'button button-ghost', 'Abrir'); open.type = 'button'; open.dataset.action = 'open-playlist'; open.dataset.playlistId = playlist.id;
      const play = element('button', 'button button-primary', '▶'); play.type = 'button'; play.dataset.action = 'play-playlist'; play.dataset.playlistId = playlist.id;
      actions.append(open, play); card.append(art, title, description, actions); grid.append(card);
    }
    if (selectedId) this.renderPlaylistDetail(playlists.find((item) => item.id === selectedId), songs);
  }

  renderPlaylistDetail(playlist, songs) {
    const detail = document.getElementById('playlist-detail');
    if (!playlist) { detail.classList.add('hidden'); return; }
    detail.classList.remove('hidden'); detail.replaceChildren();
    const head = element('div', 'playlist-detail-head');
    const copy = element('div'); copy.append(element('h3', '', playlist.name), element('p', 'muted', playlist.description || ''));
    const actions = element('div', 'playlist-detail-actions');
    const play = element('button', 'button button-primary', '▶ Reproducir'); play.type = 'button'; play.dataset.action = 'play-playlist'; play.dataset.playlistId = playlist.id;
    const rename = element('button', 'button button-ghost', 'Editar nombre'); rename.type = 'button'; rename.dataset.action = 'rename-playlist'; rename.dataset.playlistId = playlist.id;
    const remove = element('button', 'button button-danger', 'Eliminar'); remove.type = 'button'; remove.dataset.action = 'delete-playlist'; remove.dataset.playlistId = playlist.id;
    actions.append(play, rename, remove); head.append(copy, actions);
    const ids = playlist.items?.map((item) => item.song_id) || playlist.song_ids || [];
    const selectedSongs = ids.map((id) => songs.find((song) => song.id === id)).filter(Boolean);
    const list = element('div', 'track-list');
    this.renderSongList(list, selectedSongs, { playlistId: playlist.id, allowReorder: true });
    detail.append(head, list);
  }

  renderHistory(history) {
    const container = document.getElementById('history-list'); container.replaceChildren();
    if (!history.length) {
      const empty = element('div', 'empty-state'); empty.append(element('div', 'empty-state-icon', '◷'), element('h3', '', 'Tu historial está vacío'), element('p', '', 'Las canciones que reproduzcas aparecerán aquí.'));
      container.append(empty); return;
    }
    for (const entry of history) {
      const row = element('article', 'history-row'); row.append(element('div', 'cover-art', '♫'));
      const copy = element('div', 'history-copy'); copy.append(element('strong', '', entry.title || entry.snapshot_title || 'Sin título'), element('small', '', entry.artist || entry.snapshot_artist || 'Artista desconocido'));
      row.append(copy, element('time', 'history-date', safeDate(entry.played_at || entry.created_at)));
      if (entry.song_id) { row.dataset.action = 'play'; row.dataset.songId = entry.song_id; row.tabIndex = 0; }
      container.append(row);
    }
  }

  renderQueue(queue, currentIndex) {
    const container = document.getElementById('queue-list'); container.replaceChildren();
    if (!queue.length) { container.append(element('p', 'muted', 'La cola está vacía.')); return; }
    queue.forEach((song, index) => {
      const row = element('div', `queue-row ${index === currentIndex ? 'is-current' : ''}`);
      row.append(cover(song, ''));
      const copy = element('div', 'queue-row-copy'); copy.append(element('strong', '', song.title), element('small', '', song.artist || 'Artista desconocido'));
      const play = element('button', 'icon-button tiny', '▶'); play.type = 'button'; play.dataset.action = 'play-queue-item'; play.dataset.queueIndex = index; play.setAttribute('aria-label', 'Reproducir elemento de la cola');
      const up = element('button', 'icon-button tiny', '↑'); up.type = 'button'; up.dataset.action = 'move-queue-item'; up.dataset.direction = 'up'; up.dataset.queueIndex = index; up.disabled = index === 0; up.setAttribute('aria-label', 'Mover hacia arriba');
      const down = element('button', 'icon-button tiny', '↓'); down.type = 'button'; down.dataset.action = 'move-queue-item'; down.dataset.direction = 'down'; down.dataset.queueIndex = index; down.disabled = index === queue.length - 1; down.setAttribute('aria-label', 'Mover hacia abajo');
      const remove = element('button', 'icon-button tiny', '×'); remove.type = 'button'; remove.dataset.action = 'remove-queue-item'; remove.dataset.queueIndex = index; remove.setAttribute('aria-label', 'Quitar de la cola');
      row.append(copy, play, up, down, remove); container.append(row);
    });
  }

  setPlayerTrack(song) {
    const title = document.getElementById('player-title');
    const artist = document.getElementById('player-artist');
    const coverNode = document.getElementById('player-cover');
    title.textContent = song?.title || 'Nada reproduciéndose';
    artist.textContent = song?.artist || (song ? 'Artista desconocido' : 'Añade canciones a tu biblioteca');
    coverNode.replaceChildren();
    const fav = document.getElementById('player-favorite');
    fav.classList.toggle('is-favorite', Boolean(song?.is_favorite));
    fav.textContent = song?.is_favorite ? '♥' : '♡';
    if (song?.cover_url) {
      const img = element('img'); img.src = song.cover_url; img.alt = `Portada de ${song.title}`; coverNode.append(img);
    } else coverNode.textContent = '♫';
  }

  setPlayState(playing) {
    const button = document.getElementById('play-toggle');
    button.textContent = playing ? 'Ⅱ' : '▶';
    button.title = playing ? 'Pausar' : 'Reproducir';
    button.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
  }

  setModes({ shuffle, repeat }) {
    const shuffleButton = document.getElementById('shuffle-toggle');
    const repeatButton = document.getElementById('repeat-toggle');
    shuffleButton.classList.toggle('is-active', Boolean(shuffle));
    repeatButton.classList.toggle('is-active', repeat !== 'off');
    repeatButton.textContent = repeat === 'one' ? '↻¹' : '↻';
    repeatButton.title = `Repetir: ${repeat === 'off' ? 'apagado' : repeat === 'one' ? 'una canción' : 'lista completa'}`;
  }

  setProgress({ currentTime = 0, duration = 0, percent = 0 }) {
    document.getElementById('current-time').textContent = formatTime(currentTime);
    document.getElementById('total-time').textContent = formatTime(duration);
    document.getElementById('progress-range').value = Math.round(percent * 1000);
  }
}
