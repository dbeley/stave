/**
 * A thin port over the MediaSession API.
 *
 * MediaSession is what puts the track on the lock screen, in the Android
 * notification and on Bluetooth head units — essential for the Android build.
 * Abstracting it keeps the player testable in jsdom, where the API is absent.
 */

import type { Track } from '$lib/domain/types';
import { APP_NAME, DEFAULT_APP_NAME } from '$lib/config';

export interface MediaSessionPort {
  update(track: Track | undefined, urls: { coverArt?: string; stream?: string }): void;
  setPlaybackState(state: 'playing' | 'paused' | 'none'): void;
  setPosition(duration: number, position: number, rate: number): void;
  bind(handlers: {
    play: () => void;
    pause: () => void;
    next: () => void;
    previous: () => void;
    seek?: (time: number) => void;
  }): void;
}

export interface MediaMetadataLike {
  title: string;
  artist: string;
  album: string;
  artwork: { src: string; sizes?: string; type?: string }[];
}

/** Real implementation backed by navigator.mediaSession. */
export class BrowserMediaSession implements MediaSessionPort {
  constructor(private readonly session: MediaSession | undefined = navigator.mediaSession) {}

  get available(): boolean {
    return Boolean(this.session);
  }

  update(track: Track | undefined, urls: { coverArt?: string; stream?: string }): void {
    if (!this.session) return;
    /*
     * Everything here is best-effort: the OS media controls are a nicety and must
     * never be able to break playback. `MediaSession.metadata` is strictly typed in
     * Chromium — assigning a plain object throws "The provided value is not of type
     * 'MediaMetadata'", and because the player sets metadata as part of loading a
     * track, that exception aborted the load and left playback stuck. So: build a
     * real MediaMetadata where the constructor exists, and swallow any failure.
     */
    try {
      if (!track) {
        this.session.metadata = null;
        return;
      }
      const artwork: { src: string; sizes?: string }[] = [];
      if (urls.coverArt) {
        artwork.push({ src: urls.coverArt, sizes: '600x600' });
      }
      const metadata: MediaMetadataLike = {
        title: track.title,
        artist: track.artistName ?? '',
        album: track.albumName ?? '',
        artwork,
      };
      const MediaMetadataCtor = (globalThis as { MediaMetadata?: typeof MediaMetadata })
        .MediaMetadata;
      this.session.metadata =
        typeof MediaMetadataCtor === 'function'
          ? new MediaMetadataCtor(metadata as MediaMetadataInit)
          : (metadata as unknown as MediaMetadata);
    } catch {
      // A MediaSession that refuses our metadata costs the lock-screen artwork;
      // it must not cost the music.
    }
  }

  setPlaybackState(state: 'playing' | 'paused' | 'none'): void {
    if (!this.session) return;
    try {
      this.session.playbackState = state;
    } catch {
      /* best-effort, as above */
    }
  }

  setPosition(duration: number, position: number, rate: number): void {
    if (!this.session?.setPositionState) return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      this.session.setPositionState({
        duration,
        position: Math.min(Math.max(position, 0), duration),
        playbackRate: rate,
      });
    } catch {
      // Browsers throw when the values are inconsistent mid-seek; harmless.
    }
  }

  bind(handlers: {
    play: () => void;
    pause: () => void;
    next: () => void;
    previous: () => void;
    seek?: (time: number) => void;
  }): void {
    if (!this.session) return;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        this.session?.setActionHandler(action, handler);
      } catch {
        /* unsupported action */
      }
    };
    set('play', () => handlers.play());
    set('pause', () => handlers.pause());
    set('nexttrack', () => handlers.next());
    set('previoustrack', () => handlers.previous());
    set('stop', () => handlers.pause());
    if (handlers.seek) set('seekto', (details) => handlers.seek?.(details.seekTime ?? 0));
  }
}

/**
 * The slice of `@capgo/capacitor-media-session` this port uses, declared
 * structurally: tests inject a fake, and the plugin (which cannot run in jsdom)
 * never has to be imported by a unit test.
 */
export interface NativeMediaSessionApi {
  setMetadata(options: MediaMetadataLike): Promise<void>;
  setPlaybackState(options: { playbackState: 'none' | 'paused' | 'playing' }): Promise<void>;
  setPositionState(options: {
    duration: number;
    playbackRate: number;
    position: number;
  }): Promise<void>;
  setActionHandler(
    options: { action: NativeMediaAction },
    handler: ((details: { seekTime?: number | null }) => void) | null,
  ): Promise<void>;
}

export type NativeMediaAction =
  | 'play'
  | 'pause'
  | 'seekbackward'
  | 'seekforward'
  | 'previoustrack'
  | 'nexttrack'
  | 'seekto'
  | 'stop';

/**
 * MediaSession on Android, where `navigator.mediaSession` does not exist.
 *
 * The Android WebView implements no part of the Web Media Session API, so the
 * browser port above is a silent no-op there: no notification, no lock-screen
 * controls, nothing on a head unit. The plugin also runs a `mediaPlayback`
 * foreground service while the session is active, which is what stops Android
 * from suspending the WebView and killing playback in the background.
 *
 * Every call is a promise and every failure is swallowed — the OS controls are a
 * nicety and must never be able to break playback (the browser port learned that
 * one the expensive way).
 */
export class NativeMediaSession implements MediaSessionPort {
  constructor(private readonly api: NativeMediaSessionApi) {}

  private call(action: () => Promise<void>): void {
    try {
      void action().catch(() => {});
    } catch {
      /* best-effort, as above */
    }
  }

  update(track: Track | undefined, urls: { coverArt?: string; stream?: string }): void {
    if (!track) return;
    const artwork = urls.coverArt ? [{ src: urls.coverArt, sizes: '600x600' }] : [];
    this.call(() =>
      this.api.setMetadata({
        title: track.title,
        artist: track.artistName ?? '',
        album: track.albumName ?? '',
        artwork,
      }),
    );
  }

  setPlaybackState(state: 'playing' | 'paused' | 'none'): void {
    this.call(() => this.api.setPlaybackState({ playbackState: state }));
  }

  setPosition(duration: number, position: number, rate: number): void {
    if (!Number.isFinite(duration) || duration <= 0) return;
    this.call(() =>
      this.api.setPositionState({
        duration,
        playbackRate: rate,
        position: Math.min(Math.max(position, 0), duration),
      }),
    );
  }

  bind(handlers: {
    play: () => void;
    pause: () => void;
    next: () => void;
    previous: () => void;
    seek?: (time: number) => void;
  }): void {
    const set = (
      action: NativeMediaAction,
      handler: ((details: { seekTime?: number | null }) => void) | null,
    ) => this.call(() => this.api.setActionHandler({ action }, handler));

    set('play', () => handlers.play());
    set('pause', () => handlers.pause());
    set('nexttrack', () => handlers.next());
    set('previoustrack', () => handlers.previous());
    set('stop', () => handlers.pause());
    if (handlers.seek) set('seekto', (details) => handlers.seek?.(details?.seekTime ?? 0));
  }
}

/** No-op port for tests and for platforms without MediaSession. */
export class NullMediaSession implements MediaSessionPort {
  update(): void {}
  setPlaybackState(): void {}
  setPosition(): void {}
  bind(): void {}
}

/** Human-readable client name used in notifications. */
export const MEDIA_SESSION_APP_NAME = APP_NAME || DEFAULT_APP_NAME;
