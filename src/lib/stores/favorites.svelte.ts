/**
 * Favorites (Subsonic "starred" entities).
 *
 * Two things make this more than a thin wrapper:
 *   - toggles are optimistic, so a slow round-trip never blocks the UI, and are
 *     rolled back on failure;
 *   - overrides are tracked locally, because the entity you starred from an
 *     album page is not necessarily in the starred list yet.
 */

import type { SubsonicClient } from '$lib/api/client';
import { describeError } from '$lib/api/errors';
import {
  emptyStarredResults,
  type Album,
  type Artist,
  type StarredResults,
  type Track,
} from '$lib/domain/types';

export type FavoriteKind = 'album' | 'artist' | 'track';

export interface FavoritesDeps {
  client: () => SubsonicClient | null;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
}

export interface FavoritesState extends StarredResults {
  loading: boolean;
  error: string | undefined;
  loadedAt: number | undefined;
}

const OVERRIDE_TTL_MS = 30_000;

export class FavoritesStore {
  state: FavoritesState;

  private readonly deps: FavoritesDeps;
  /** Local truth after an optimistic toggle: "album:x" -> starred. */
  private readonly overrides = new Map<string, boolean>();
  private inflight: Promise<void> | null = null;

  constructor(deps: FavoritesDeps) {
    this.deps = deps;
    this.state = $state<FavoritesState>({
      ...emptyStarredResults(),
      loading: false,
      error: undefined,
      loadedAt: undefined,
    });
  }

  get albums(): Album[] {
    return this.state.albums;
  }

  get artists(): Artist[] {
    return this.state.artists;
  }

  get tracks(): Track[] {
    return this.state.tracks;
  }

  get total(): number {
    return this.state.albums.length + this.state.artists.length + this.state.tracks.length;
  }

  get isEmpty(): boolean {
    return this.total === 0;
  }

  async load(options: { refresh?: boolean } = {}): Promise<void> {
    if (this.inflight) return this.inflight;
    if (!options.refresh && this.state.loadedAt !== undefined) return;

    this.inflight = (async () => {
      const client = this.deps.client();
      this.state = { ...this.state, loading: true, error: undefined };
      if (!client) {
        this.state = { ...this.state, loading: false, error: 'not connected' };
        return;
      }
      try {
        const starred = await client.getStarred();
        this.overrides.clear();
        this.state = { ...starred, loading: false, error: undefined, loadedAt: Date.now() };
      } catch (error) {
        const message = describeError(error);
        this.state = { ...this.state, loading: false, error: message };
        this.deps.onError?.(message);
      }
    })().finally(() => {
      this.inflight = null;
    });

    return this.inflight;
  }

  // ------------------------------------------------------------------ checks

  isStarred(kind: FavoriteKind, id: string, fallback = false): boolean {
    /*
     * Read the reactive list *before* the override can short-circuit. A caller
     * wraps this in `$derived`, and the first toggle installs an optimistic
     * override: if the override returned early without touching `this.state`,
     * the derived would drop its subscription to the starred lists, so the
     * second (un-star) toggle only changed the lists and never re-rendered —
     * the star stayed on screen. Touching the list every call keeps the
     * subscription alive regardless of the override.
     */
    const listed = this.isInList(kind, id);
    const override = this.overrides.get(`${kind}:${id}`);
    if (override !== undefined) return override;
    return listed || fallback;
  }

  private isInList(kind: FavoriteKind, id: string): boolean {
    switch (kind) {
      case 'album':
        return this.state.albums.some((album) => album.id === id);
      case 'artist':
        return this.state.artists.some((artist) => artist.id === id);
      case 'track':
        return this.state.tracks.some((track) => track.id === id);
    }
  }

  isAlbumStarred(album: Album): boolean {
    return this.isStarred('album', album.id, album.starred);
  }

  isArtistStarred(artist: Artist): boolean {
    return this.isStarred('artist', artist.id, artist.starred);
  }

  isTrackStarred(track: Track): boolean {
    return this.isStarred('track', track.id, track.starred);
  }

  // ------------------------------------------------------------------ toggles

  /** Returns the new state. Never throws — failures are reported and reverted. */
  async toggleAlbum(album: Album): Promise<boolean> {
    const next = !this.isAlbumStarred(album);
    return this.applyToggle(
      'album',
      album.id,
      next,
      () =>
        next
          ? this.client().star({ albumId: album.id })
          : this.client().unstar({ albumId: album.id }),
      (starred) => this.mutateAlbum(album, starred),
      album.name,
    );
  }

  async toggleArtist(artist: Artist): Promise<boolean> {
    const next = !this.isArtistStarred(artist);
    return this.applyToggle(
      'artist',
      artist.id,
      next,
      () =>
        next
          ? this.client().star({ artistId: artist.id })
          : this.client().unstar({ artistId: artist.id }),
      (starred) => this.mutateArtist(artist, starred),
      artist.name,
    );
  }

  async toggleTrack(track: Track): Promise<boolean> {
    const next = !this.isTrackStarred(track);
    return this.applyToggle(
      'track',
      track.id,
      next,
      () => (next ? this.client().star({ id: track.id }) : this.client().unstar({ id: track.id })),
      (starred) => this.mutateTrack(track, starred),
      track.title,
    );
  }

  /** Toggle whatever an action-menu target refers to. */
  async toggle(kind: FavoriteKind, entity: Album | Artist | Track): Promise<boolean> {
    switch (kind) {
      case 'album':
        return this.toggleAlbum(entity as Album);
      case 'artist':
        return this.toggleArtist(entity as Artist);
      case 'track':
        return this.toggleTrack(entity as Track);
    }
  }

  clear(): void {
    this.overrides.clear();
    this.state = {
      ...emptyStarredResults(),
      loading: false,
      error: undefined,
      loadedAt: undefined,
    };
  }

  private async applyToggle(
    kind: FavoriteKind,
    id: string,
    next: boolean,
    call: () => Promise<void>,
    /** Applies a *given* starred state, so a failed request can revert it. */
    mutate: (starred: boolean) => void,
    label: string,
  ): Promise<boolean> {
    // Optimistic: show the new state immediately.
    this.overrides.set(`${kind}:${id}`, next);
    mutate(next);

    try {
      await call();
      this.deps.onSuccess?.(next ? `starred ${kind}: ${label}` : `unstarred ${kind}: ${label}`);
      this.scheduleOverrideExpiry(kind, id);
      return next;
    } catch (error) {
      // Roll back to the inverse of what we optimistically applied.
      this.overrides.set(`${kind}:${id}`, !next);
      mutate(!next);
      const message = describeError(error);
      this.deps.onError?.(`could not update favorite: ${message}`);
      return !next;
    }
  }

  /** Overrides are a UI hint; drop them once the server state catches up. */
  private scheduleOverrideExpiry(kind: FavoriteKind, id: string): void {
    setTimeout(() => {
      this.overrides.delete(`${kind}:${id}`);
    }, OVERRIDE_TTL_MS);
  }

  private mutateAlbum(album: Album, starred: boolean): void {
    const others = this.state.albums.filter((entry) => entry.id !== album.id);
    this.state.albums = starred ? [{ ...album, starred: true }, ...others] : others;
  }

  private mutateArtist(artist: Artist, starred: boolean): void {
    const others = this.state.artists.filter((entry) => entry.id !== artist.id);
    this.state.artists = starred ? [{ ...artist, starred: true }, ...others] : others;
  }

  private mutateTrack(track: Track, starred: boolean): void {
    const others = this.state.tracks.filter((entry) => entry.id !== track.id);
    this.state.tracks = starred ? [{ ...track, starred: true }, ...others] : others;
  }

  private client(): SubsonicClient {
    const client = this.deps.client();
    if (!client) throw new Error('not connected to a server');
    return client;
  }
}
