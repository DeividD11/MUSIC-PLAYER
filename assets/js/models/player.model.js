import { formatTime } from '../utils/dom.js';

export class PlayerModel extends EventTarget {
  constructor(audioElement, localRepository) {
    super();
    this.audio = audioElement;
    this.localRepository = localRepository;
    this.currentTrack = null;
    this.queue = [];
    this.originalQueue = [];
    this.currentIndex = -1;
    this.shuffle = false;
    this.repeat = 'off';
    this.objectUrl = null;
    this._bindAudioEvents();
  }

  _emit(name, detail = {}) { this.dispatchEvent(new CustomEvent(name, { detail })); }

  _bindAudioEvents() {
    this.audio.addEventListener('play', () => this._emit('state', { playing: true }));
    this.audio.addEventListener('pause', () => this._emit('state', { playing: false }));
    this.audio.addEventListener('timeupdate', () => this._emit('progress', {
      currentTime: this.audio.currentTime || 0,
      duration: Number.isFinite(this.audio.duration) ? this.audio.duration : (this.currentTrack?.duration_seconds || 0),
      percent: this.audio.duration ? this.audio.currentTime / this.audio.duration : 0,
    }));
    this.audio.addEventListener('loadedmetadata', () => this._emit('progress', {
      currentTime: this.audio.currentTime || 0,
      duration: this.audio.duration || 0,
      percent: 0,
    }));
    this.audio.addEventListener('ended', () => this._handleEnded());
    this.audio.addEventListener('error', () => this._emit('error', { message: 'El navegador no pudo reproducir este archivo.' }));
    this.audio.addEventListener('ratechange', () => this._emit('settings', { speed: this.audio.playbackRate }));
    this.audio.addEventListener('volumechange', () => this._emit('settings', { volume: this.audio.volume, muted: this.audio.muted }));
  }

  setQueue(tracks, currentId = null) {
    this.originalQueue = [...tracks];
    this.queue = [...tracks];
    this.currentIndex = currentId ? this.queue.findIndex((track) => track.id === currentId) : -1;
    this._emit('queue', { queue: this.queue, currentIndex: this.currentIndex });
  }

  addToQueue(track, playNext = false) {
    const currentId = this.currentTrack?.id || this.queue[this.currentIndex]?.id || null;
    this.queue = this.queue.filter((item) => item.id !== track.id || item.id === currentId);
    this.currentIndex = currentId ? this.queue.findIndex((item) => item.id === currentId) : -1;
    if (track.id !== currentId) {
      const insertAt = playNext ? Math.max(0, this.currentIndex + 1) : this.queue.length;
      this.queue.splice(insertAt, 0, track);
    }
    this._emit('queue', { queue: this.queue, currentIndex: this.currentIndex });
  }

  moveInQueue(from, to) {
    if (from < 0 || to < 0 || from >= this.queue.length || to >= this.queue.length || from === to) return;
    const [item] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, item);
    if (this.currentIndex === from) this.currentIndex = to;
    else if (from < this.currentIndex && to >= this.currentIndex) this.currentIndex -= 1;
    else if (from > this.currentIndex && to <= this.currentIndex) this.currentIndex += 1;
    this._emit('queue', { queue: this.queue, currentIndex: this.currentIndex });
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.queue.splice(index, 1);
    if (index < this.currentIndex) this.currentIndex -= 1;
    this._emit('queue', { queue: this.queue, currentIndex: this.currentIndex });
  }

  clearQueue() {
    this.queue = this.currentTrack ? [this.currentTrack] : [];
    this.currentIndex = this.currentTrack ? 0 : -1;
    this._emit('queue', { queue: this.queue, currentIndex: this.currentIndex });
  }

  async playTrack(track, { autoplay = true, sourceUrl = null } = {}) {
    if (!track) return;
    let src = sourceUrl || track.audio_url || '';
    if (track.source_type === 'local' || !track.source_type) {
      const blob = await this.localRepository.getAudio(track.id);
      if (!blob) throw new Error('Este archivo local no está disponible en este dispositivo. Pídele al propietario que lo suba a su almacenamiento privado.');
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = URL.createObjectURL(blob);
      src = this.objectUrl;
    }
    if (!src) throw new Error('No hay un archivo de audio disponible para esta canción.');
    this.audio.pause();
    this.audio.src = src;
    this.audio.load();
    this.currentTrack = track;
    this._emit('trackchange', { track });
    if (autoplay) {
      try { await this.audio.play(); }
      catch { this._emit('error', { message: 'El navegador bloqueó la reproducción. Pulsa reproducir para intentarlo otra vez.' }); }
    }
  }

  async togglePlay() {
    if (!this.currentTrack) {
      if (this.queue.length) return this.playTrack(this.queue[0]);
      throw new Error('Primero añade una canción a tu biblioteca.');
    }
    if (this.audio.paused) await this.audio.play();
    else this.audio.pause();
  }

  async next() {
    if (!this.queue.length) return;
    let nextIndex;
    if (this.shuffle && this.queue.length > 1) {
      do { nextIndex = Math.floor(Math.random() * this.queue.length); }
      while (nextIndex === this.currentIndex);
    } else nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.queue.length) {
      if (this.repeat !== 'all') return;
      nextIndex = 0;
    }
    this.currentIndex = nextIndex;
    await this.playTrack(this.queue[nextIndex]);
    this._emit('queue', { queue: this.queue, currentIndex: this.currentIndex });
  }

  async previous() {
    if (!this.currentTrack) return;
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    if (!this.queue.length) return;
    this.currentIndex = this.currentIndex <= 0 ? (this.repeat === 'all' ? this.queue.length - 1 : 0) : this.currentIndex - 1;
    await this.playTrack(this.queue[this.currentIndex]);
    this._emit('queue', { queue: this.queue, currentIndex: this.currentIndex });
  }

  async _handleEnded() {
    if (this.repeat === 'one') {
      this.audio.currentTime = 0;
      await this.audio.play().catch(() => {});
      return;
    }
    await this.next();
  }

  seek(percent) {
    if (!Number.isFinite(this.audio.duration) || this.audio.duration <= 0) return;
    this.audio.currentTime = Math.max(0, Math.min(1, percent)) * this.audio.duration;
  }

  setVolume(value) { this.audio.volume = Math.max(0, Math.min(1, Number(value))); this.audio.muted = this.audio.volume === 0; }
  toggleMute() { this.audio.muted = !this.audio.muted; }
  setSpeed(value) { this.audio.playbackRate = Math.max(0.5, Math.min(2, Number(value))); }
  toggleShuffle() { this.shuffle = !this.shuffle; this._emit('modes', { shuffle: this.shuffle, repeat: this.repeat }); }
  cycleRepeat() { this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off'; this._emit('modes', { shuffle: this.shuffle, repeat: this.repeat }); }
  get isPlaying() { return !this.audio.paused; }
  get currentTimeLabel() { return formatTime(this.audio.currentTime); }
  get durationLabel() { return formatTime(this.audio.duration || this.currentTrack?.duration_seconds || 0); }

  destroy() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }
}
