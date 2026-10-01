/**
 * Playback.
 *
 * The player owns exactly one <audio> element and translates user intent
 * ("play this", "add this next", "skip") into queue operations, URL resolution,
 * scrobbles and auto-DJ refills.
 *
 * Everything external is injected: the audio element (via `AudioPort`), the URL
 * resolver (so the offline cache can intercept), the Subsonic client (for
 * scrobbling and similarity) and the MediaSession port. Tests supply fakes and
 * drive the clock directly.
 */

import type { SubsonicClient } from '$lib/api/client';
import { describeError } from '$lib/api/errors';
import type { Album, Track } from '$lib/domain/types';
import { buildAutoDjQueue, type AutoDjOutcome } from '$lib/player/autodj';
import { NullMediaSession, type MediaSessionPort } from '$lib/player/mediaSession';
import type { QueueStore } from '$lib/stores/queue.svelte';
import type { SettingsStore } from '$lib/stores/settings.svelte';
import type { ToastStore } from '$lib/stores/toast.svelte';

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** 'end' appends; 'next' inserts directly after the playing track. */
export type EnqueueMode = 'end' | 'next';

export type AudioEventName =
  | 'timeupdate'
  | 'ended'
  | 'error'
  | 'playing'
  | 'pause'
  | 'loadstart'
  | 'loadedmetadata'
  | 'durationchange'
  | 'canplay'
  | 'stalled';

export interface AudioPort {
  src: string;
  volume: number;
  muted: boolean;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  on(event: AudioEventName, handler: () => void): () => void;
}

const HISTORY_LIMIT = 50;
/** Scrobble once half the track (or four minutes) has been heard. */
const SCROBBLE_FRACTION = 0.5;
const SCROBBLE_MAX_SECONDS = 240;
/** Tracks shorter than this are scrobbled when they finish. */
const SCROBBLE_MIN_DURATION = 30;
/** Give up after this many consecutive playback failures. */
const MAX_CONSECUTIVE_ERRORS = 3;

export interface PlayerState {
  status: PlaybackStatus;
  track: Track | undefined;
  position: number;
  duration: number;
  /** Where the current audio came from. */
  source: 'cache' | 'stream' | undefined;
  error: string | undefined;
  /** Number of tracks the auto-DJ has added this session. */
  autoDjAdded: number;
}

export interface PlayerDeps {
  queue: QueueStore;
  settings: SettingsStore;
  toasts?: Pick<ToastStore, 'info' | 'ok' | 'warn' | 'error'>;
  client?: () => SubsonicClient | null;
  /** Cache-aware URL resolution; defaults to a plain stream URL. */
  resolveUrl?: (track: Track) => Promise<{ url: string; source: 'cache' | 'stream' }>;
  createAudio?: () => AudioPort;
  mediaSession?: MediaSessionPort;
  /** Override the auto-DJ (tests). */
  autoDj?: (request: Parameters<typeof buildAutoDjQueue>[0]) => Promise<AutoDjOutcome>;
}

export class PlayerStore {
  readonly state: PlayerState;
  /** Most recent tracks, newest first — seeds the auto-DJ. */
  readonly history: Track[] = [];

  private readonly deps: PlayerDeps;
  private readonly audio: AudioPort;
  private readonly mediaSession: MediaSessionPort;
  private detach: (() => void)[] = [];
  private scrobbled = false;
  private reportedNowPlaying = false;
  private consecutiveErrors = 0;
  private refill: Promise<boolean> | null = null;
  /** Set right after a refill so the next track load does not refill again. */
  private suppressRefill = false;
  /** Guards against overlapping track transitions (double `n` presses). */
  private transitioning = false;

  constructor(deps: PlayerDeps) {
    this.deps = deps;
    this.audio = (deps.createAudio ?? createHtmlAudio)();
    this.mediaSession = deps.mediaSession ?? new NullMediaSession();
    this.state = $state<PlayerState>({
      status: 'idle',
      track: undefined,
      position: 0,
      duration: 0,
      source: undefined,
      error: undefined,
      autoDjAdded: 0,
    });
    this.attachAudio();
    this.bindMediaSession();
    this.audio.volume = deps.settings.state.volume;
  }

  // ---------------------------------------------------------------- reads

  get isPlaying(): boolean {
    return this.state.status === 'playing';
  }

  get track(): Track | undefined {
    return this.state.track;
  }

  get progress(): number {
    if (this.state.duration <= 0) return 0;
    return Math.min(1, this.state.position / this.state.duration);
  }

  get remainingSec(): number {
    return Math.max(0, this.state.duration - this.state.position);
  }

  get volume(): number {
    return this.audio.volume;
  }

  get muted(): boolean {
    return this.audio.muted;
  }

  // ------------------------------------------------------------- commands

  /**
   * Replace the queue and start playing at `startIndex`.
   * This is what clicking a track does.
   */
  async playTracks(tracks: Track[], startIndex = 0): Promise<void> {
    if (tracks.length === 0) return;
    this.deps.queue.set(tracks, startIndex);
    await this.loadCurrent(true);
  }

  /** Play a track immediately, replacing the queue. */
  async playNow(track: Track, context?: { tracks: Track[]; index: number }): Promise<void> {
    if (context && context.tracks.length > 0) {
      const index =
        context.index >= 0 ? context.index : context.tracks.findIndex((t) => t.id === track.id);
      await this.playTracks(context.tracks, index < 0 ? 0 : index);
      return;
    }
    await this.playTracks([track], 0);
  }

  /** Play an album from the top (the album page's primary action). */
  async playAlbum(album: Album): Promise<void> {
    const tracks = album.tracks ?? [];
    if (tracks.length === 0) return;
    await this.playTracks(tracks, 0);
  }

  /**
   * Add tracks to the queue without interrupting playback.
   * Returns how many were added.
   */
  enqueue(tracks: Track[], mode: EnqueueMode = 'end'): number {
    if (tracks.length === 0) return 0;
    if (mode === 'next') this.deps.queue.insertAfterCurrent(tracks);
    else this.deps.queue.append(tracks);
    return tracks.length;
  }

  async enqueueAlbum(album: Album, mode: EnqueueMode = 'end'): Promise<number> {
    const tracks = album.tracks ?? [];
    if (tracks.length === 0) {
      const loaded = await this.loadAlbumTracks(album);
      return this.enqueue(loaded, mode);
    }
    return this.enqueue(tracks, mode);
  }

  async play(): Promise<void> {
    if (!this.state.track) {
      // Nothing loaded yet: start where the queue points.
      if (!this.deps.queue.isEmpty) await this.loadCurrent(true);
      return;
    }
    try {
      await this.audio.play();
      this.state.status = 'playing';
      this.mediaSession.setPlaybackState('playing');
    } catch (error) {
      this.state.status = 'error';
      this.state.error = describeError(error);
      this.deps.toasts?.error(`playback failed: ${this.state.error}`);
    }
  }

  pause(): void {
    this.audio.pause();
    this.state.status = 'paused';
    this.mediaSession.setPlaybackState('paused');
  }

  async toggle(): Promise<void> {
    if (this.state.status === 'playing') this.pause();
    else await this.play();
  }

  stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.state.status = 'idle';
    this.state.position = 0;
    this.mediaSession.setPlaybackState('none');
  }

  /** Skip forward. `userInitiated` distinguishes a keypress from a track ending. */
  async next(userInitiated = true): Promise<void> {
    const result = this.deps.queue.next();
    if (result.kind === 'repeat-one') {
      // Natural end of a track with repeat "one": loop it.
      if (!userInitiated) {
        this.seek(0);
        await this.play();
        return;
      }
      // A manual skip should move on rather than restart the same track.
      const index = this.deps.queue.state.index + 1;
      if (index < this.deps.queue.length) {
        this.deps.queue.jumpTo(index);
        await this.loadCurrent(true);
        return;
      }
      if (await this.refillQueue()) {
        this.deps.queue.jumpTo(this.deps.queue.length - 1);
        await this.loadCurrent(true);
        return;
      }
      this.stop();
      return;
    }
    if (result.kind === 'index') {
      this.deps.queue.jumpTo(result.index);
      await this.loadCurrent(true);
      return;
    }
    // End of queue: the auto-DJ gets a chance to keep the music going.
    if (userInitiated || this.deps.settings.state.autoDj) {
      if (await this.refillQueue()) {
        this.deps.queue.jumpTo(
          Math.min(this.deps.queue.state.index + 1, this.deps.queue.length - 1),
        );
        await this.loadCurrent(true);
        return;
      }
    }
    this.stop();
  }

  /** Back: restart the track when we are past the first few seconds. */
  async previous(): Promise<void> {
    if (this.state.position > 3) {
      this.seek(0);
      return;
    }
    const index = this.deps.queue.previous();
    if (index < 0) return;
    this.deps.queue.jumpTo(index);
    await this.loadCurrent(true);
  }

  seek(seconds: number): void {
    const duration = this.state.duration || this.audio.duration || 0;
    const target = Math.min(Math.max(seconds, 0), duration > 0 ? duration : seconds);
    if (Number.isFinite(target)) this.audio.currentTime = target;
    this.state.position = target;
    this.syncPositionState();
  }

  seekBy(delta: number): void {
    this.seek(this.state.position + delta);
  }

  seekFraction(fraction: number): void {
    if (this.state.duration <= 0) return;
    this.seek(this.state.duration * Math.min(Math.max(fraction, 0), 1));
  }

  setVolume(value: number): void {
    const volume = Math.min(Math.max(value, 0), 1);
    this.audio.volume = volume;
    this.deps.settings.update({ volume });
  }

  volumeBy(delta: number): void {
    this.setVolume(this.audio.volume + delta);
  }

  toggleMute(): void {
    this.audio.muted = !this.audio.muted;
  }

  get repeatMode(): QueueStore['state']['repeat'] {
    return this.deps.queue.state.repeat;
  }

  cycleRepeat(): void {
    this.deps.queue.cycleRepeat();
  }

  toggleShuffle(): boolean {
    return this.deps.queue.toggleShuffle();
  }

  // -------------------------------------------------------------- internals

  private async loadCurrent(autoplay: boolean): Promise<void> {
    const track = this.deps.queue.currentTrack;
    if (!track) {
      this.state.track = undefined;
      this.state.status = 'idle';
      return;
    }

    this.transitioning = true;
    this.state.status = 'loading';
    this.state.track = track;
    this.state.position = 0;
    this.state.duration = track.durationSec || 0;
    this.state.error = undefined;
    this.scrobbled = false;
    this.reportedNowPlaying = false;

    let url: string;
    let source: 'cache' | 'stream' = 'stream';
    try {
      if (this.deps.resolveUrl) {
        const resolved = await this.deps.resolveUrl(track);
        url = resolved.url;
        source = resolved.source;
      } else {
        const client = this.deps.client?.();
        if (!client) throw new Error('not connected to a server');
        url = client.streamUrl(track.id, {
          maxBitRate: this.deps.settings.state.streamMaxBitRate,
        });
      }
    } catch (error) {
      this.state.status = 'error';
      this.state.error = describeError(error);
      this.deps.toasts?.error(`cannot play "${track.title}": ${this.state.error}`);
      this.transitioning = false;
      return;
    }

    this.state.source = source;
    this.audio.src = url;
    if (typeof this.audio.load === 'function') this.audio.load();

    this.pushHistory(track);
    this.updateMediaSession(track, url);

    if (autoplay) {
      try {
        await this.audio.play();
        this.state.status = 'playing';
        this.mediaSession.setPlaybackState('playing');
        this.reportNowPlaying(track);
      } catch (error) {
        this.state.status = 'error';
        this.state.error = describeError(error);
        this.deps.toasts?.error(`playback failed: ${this.state.error}`);
      }
    } else {
      this.state.status = 'paused';
    }

    this.transitioning = false;
    if (this.suppressRefill) {
      this.suppressRefill = false;
    } else {
      void this.maybeRefill();
    }
  }

  private attachAudio(): void {
    this.detach.push(
      this.audio.on('timeupdate', () => {
        this.state.position = this.audio.currentTime;
        if (this.state.duration <= 0 && this.audio.duration > 0) {
          this.state.duration = this.audio.duration;
        }
        this.syncPositionState();
        this.maybeScrobble();
        void this.maybeRefill();
      }),
      this.audio.on('loadedmetadata', () => {
        if (this.audio.duration > 0) this.state.duration = this.audio.duration;
      }),
      this.audio.on('durationchange', () => {
        if (this.audio.duration > 0) this.state.duration = this.audio.duration;
      }),
      this.audio.on('playing', () => {
        this.consecutiveErrors = 0;
        this.state.status = 'playing';
      }),
      this.audio.on('pause', () => {
        if (this.state.status === 'playing') this.state.status = 'paused';
      }),
      this.audio.on('ended', () => {
        void this.handleEnded();
      }),
      this.audio.on('error', () => {
        this.handleAudioError();
      }),
    );
  }

  private async handleEnded(): Promise<void> {
    const track = this.state.track;
    // Short tracks never reach the mid-point threshold.
    if (track && !this.scrobbled && this.deps.settings.state.scrobblingEnabled) {
      if (track.durationSec > 0 && track.durationSec < SCROBBLE_MIN_DURATION) {
        void this.submitScrobble(track);
      }
    }
    await this.next(false);
  }

  private handleAudioError(): void {
    const track = this.state.track;
    this.consecutiveErrors += 1;
    this.state.status = 'error';
    this.state.error = 'playback error';
    this.deps.toasts?.error(`cannot play "${track?.title ?? 'track'}"`);

    if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      this.deps.toasts?.warn('several tracks failed to play — stopping');
      this.stop();
      return;
    }
    // Try the next track, but only if there is one.
    void this.next(false);
  }

  /**
   * Keep the queue fed. Runs when the queue is nearly empty rather than only at
   * the end, so playback never gaps while a fetch is in flight.
   */
  private async maybeRefill(): Promise<boolean> {
    if (!this.deps.settings.state.autoDj) return false;
    const queue = this.deps.queue;
    if (queue.isEmpty) return false;
    const threshold = Math.max(0, this.deps.settings.state.autoDjThreshold);
    if (queue.upcoming.length > threshold) return false;
    if (this.refill) return this.refill;
    this.refill = this.refillQueue();
    try {
      return await this.refill;
    } finally {
      this.refill = null;
    }
  }

  /** Ask the auto-DJ for more tracks and append them. */
  private async refillQueue(): Promise<boolean> {
    if (!this.deps.settings.state.autoDj) return false;
    const client = this.deps.client?.();
    const queue = this.deps.queue;
    const batchSize = Math.max(1, this.deps.settings.state.autoDjBatchSize);
    const exclude = new Set(queue.tracks.map((track) => track.id));

    const seedSource = this.history.length > 0 ? this.history : queue.tracks;
    const build = this.deps.autoDj ?? buildAutoDjQueue;

    let outcome: AutoDjOutcome;
    try {
      outcome = await build({
        history: seedSource,
        exclude,
        count: batchSize,
        requestSimilar: async (seed, count) => {
          if (!client) return [];
          return client.getSimilarSongsSafe(seed.id, count);
        },
        requestRandom: async (count) => {
          if (!client) return [];
          return client.getRandomSongs({ size: count });
        },
      });
    } catch (error) {
      this.deps.toasts?.warn(`auto-dj failed: ${describeError(error)}`);
      return false;
    }

    if (outcome.tracks.length === 0) {
      this.deps.toasts?.warn('auto-dj found nothing else to play');
      return false;
    }

    this.deps.queue.append(outcome.tracks);
    this.state.autoDjAdded += outcome.tracks.length;
    this.deps.toasts?.info(`auto-dj: +${outcome.tracks.length} (${outcome.source})`);
    // The track we are about to load was just fetched, so do not immediately ask
    // for another batch for it (that would double every refill).
    this.suppressRefill = true;
    return true;
  }

  private maybeScrobble(): void {
    const track = this.state.track;
    if (!track || this.scrobbled || !this.deps.settings.state.scrobblingEnabled) return;
    if (track.durationSec <= 0) return;
    const threshold = Math.min(track.durationSec * SCROBBLE_FRACTION, SCROBBLE_MAX_SECONDS);
    if (this.state.position >= threshold) {
      void this.submitScrobble(track);
    }
  }

  private async submitScrobble(track: Track): Promise<void> {
    const client = this.deps.client?.();
    if (!client || !this.deps.settings.state.scrobblingEnabled) return;
    this.scrobbled = true;
    try {
      await client.scrobble({ id: track.id, submission: true });
    } catch {
      // Scrobbling is opportunistic: never interrupt playback for it.
    }
  }

  private reportNowPlaying(track: Track): void {
    if (this.reportedNowPlaying || !this.deps.settings.state.scrobblingEnabled) return;
    const client = this.deps.client?.();
    if (!client) return;
    this.reportedNowPlaying = true;
    void client.scrobble({ id: track.id, submission: false }).catch(() => {});
  }

  private pushHistory(track: Track): void {
    this.history.unshift(track);
    if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
  }

  private updateMediaSession(track: Track, url: string): void {
    const client = this.deps.client?.();
    const coverArt =
      track.coverArtId && client ? client.coverArtUrl(track.coverArtId, 600) : undefined;
    this.mediaSession.update(track, { coverArt, stream: url });
  }

  private syncPositionState(): void {
    this.mediaSession.setPosition(this.state.duration, this.state.position, 1);
  }

  private bindMediaSession(): void {
    this.mediaSession.bind({
      play: () => void this.play(),
      pause: () => this.pause(),
      next: () => void this.next(),
      previous: () => void this.previous(),
      seek: (time) => this.seek(time),
    });
  }

  /** Album tracks are only present when the album was fetched by id. */
  private async loadAlbumTracks(album: Album): Promise<Track[]> {
    const client = this.deps.client?.();
    if (!client) return [];
    try {
      const full = await client.getAlbum(album.id);
      return full.tracks ?? [];
    } catch {
      return [];
    }
  }

  /** Detach listeners (tests, teardown). */
  destroy(): void {
    for (const off of this.detach) off();
    this.detach = [];
    this.audio.pause();
  }
}

/** The real <audio> element. Created lazily so SSR/import stays side-effect free. */
export function createHtmlAudio(): AudioPort {
  const element = new Audio();
  element.preload = 'auto';
  element.crossOrigin = 'anonymous';
  return {
    get src() {
      return element.src;
    },
    set src(value: string) {
      element.src = value;
    },
    get volume() {
      return element.volume;
    },
    set volume(value: number) {
      element.volume = Math.min(Math.max(value, 0), 1);
    },
    get muted() {
      return element.muted;
    },
    set muted(value: boolean) {
      element.muted = value;
    },
    get currentTime() {
      return element.currentTime;
    },
    set currentTime(value: number) {
      element.currentTime = value;
    },
    get duration() {
      return Number.isFinite(element.duration) ? element.duration : 0;
    },
    get paused() {
      return element.paused;
    },
    play: () => element.play(),
    pause: () => element.pause(),
    load: () => element.load(),
    on(event: AudioEventName, handler: () => void) {
      element.addEventListener(event, handler);
      return () => element.removeEventListener(event, handler);
    },
  };
}
