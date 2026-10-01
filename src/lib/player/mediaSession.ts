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
    this.session.metadata = metadata as unknown as MediaMetadata;
  }

  setPlaybackState(state: 'playing' | 'paused' | 'none'): void {
    if (!this.session) return;
    this.session.playbackState = state;
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

/** No-op port for tests and for platforms without MediaSession. */
export class NullMediaSession implements MediaSessionPort {
  update(): void {}
  setPlaybackState(): void {}
  setPosition(): void {}
  bind(): void {}
}

/** Human-readable client name used in notifications. */
export const MEDIA_SESSION_APP_NAME = APP_NAME || DEFAULT_APP_NAME;
