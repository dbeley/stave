/**
 * Library loading: album lists, the artist index, album and artist detail.
 *
 * Each slice carries its own `loading`/`error` so a failing biography never
 * blanks out the rest of an artist page, and requests are de-duplicated so
 * re-entering a page does not refetch.
 */

import type { SubsonicClient } from '$lib/api/client';
import { AuthError, describeError } from '$lib/api/errors';
import type { Album, Artist, ArtistBio, ArtistsListing, Track } from '$lib/domain/types';
import type { AlbumListSort } from '$lib/domain/sort';
import { sortOption } from '$lib/domain/sort';

export interface ListSlice {
  items: Album[];
  loading: boolean;
  error: string | undefined;
  /** Offset of the next page (paginated sorts only). */
  offset: number;
  hasMore: boolean;
  loadedAt: number | undefined;
}

export interface AlbumSlice {
  album: Album | undefined;
  loading: boolean;
  error: string | undefined;
  loadedAt: number | undefined;
}

export interface ArtistSlice {
  artist: Artist | undefined;
  albums: Album[];
  topSongs: Track[];
  bio: ArtistBio | undefined;
  /** True when the server has no biography/Last.fm data (not an error). */
  bioUnavailable: boolean;
  loading: boolean;
  error: string | undefined;
  loadedAt: number | undefined;
}

export interface ArtistsSlice {
  listing: ArtistsListing | undefined;
  loading: boolean;
  error: string | undefined;
  loadedAt: number | undefined;
}

export interface LibraryDeps {
  client: () => SubsonicClient | null;
  onError?: (message: string) => void;
  pageSize?: () => number;
}

function emptyList(): ListSlice {
  return {
    items: [],
    loading: false,
    error: undefined,
    offset: 0,
    hasMore: true,
    loadedAt: undefined,
  };
}

function emptyArtistSlice(): ArtistSlice {
  return {
    artist: undefined,
    albums: [],
    topSongs: [],
    bio: undefined,
    bioUnavailable: false,
    loading: false,
    error: undefined,
    loadedAt: undefined,
  };
}

export class LibraryStore {
  albumLists: Record<string, ListSlice>;
  artists: ArtistsSlice;
  albumDetails: Record<string, AlbumSlice>;
  artistDetails: Record<string, ArtistSlice>;

  private readonly deps: LibraryDeps;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(deps: LibraryDeps) {
    this.deps = deps;
    this.albumLists = $state<Record<string, ListSlice>>({});
    this.artists = $state<ArtistsSlice>({
      listing: undefined,
      loading: false,
      error: undefined,
      loadedAt: undefined,
    });
    this.albumDetails = $state<Record<string, AlbumSlice>>({});
    this.artistDetails = $state<Record<string, ArtistSlice>>({});
  }

  // ------------------------------------------------------------ album lists

  list(sort: AlbumListSort): ListSlice {
    return this.albumLists[sort] ?? emptyList();
  }

  async loadAlbumList(sort: AlbumListSort, options: { refresh?: boolean } = {}): Promise<void> {
    const key = `list:${sort}`;
    if (this.inflight.has(key)) return this.inflight.get(key) as Promise<void>;
    const current = this.albumLists[sort];
    if (current && !options.refresh && current.loadedAt !== undefined) return;

    const promise = this.fetchAlbumList(sort, 0, options.refresh === true).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  /** Load the next page (paginated sorts only). */
  async loadMoreAlbums(sort: AlbumListSort): Promise<void> {
    const option = sortOption(sort);
    if (!option.paginated) return;
    const slice = this.list(sort);
    if (slice.loading || !slice.hasMore) return;
    const key = `list:${sort}:more`;
    if (this.inflight.has(key)) return this.inflight.get(key) as Promise<void>;
    const promise = this.fetchAlbumList(sort, slice.offset, false).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  private async fetchAlbumList(
    sort: AlbumListSort,
    offset: number,
    refresh: boolean,
  ): Promise<void> {
    const client = this.deps.client();
    const option = sortOption(sort);
    const pageSize = this.deps.pageSize?.() ?? 50;
    const previous = this.albumLists[sort] ?? emptyList();
    this.albumLists[sort] = { ...previous, loading: true, error: undefined };

    if (!client) {
      this.albumLists[sort] = { ...previous, loading: false, error: 'not connected' };
      return;
    }

    try {
      const albums = await client.getAlbumList({
        type: option.type,
        size: pageSize,
        offset,
        // Random lists are not stable, so they are always a single page.
      });
      const merged =
        refresh || offset === 0 ? albums : [...previous.items, ...dedupeAlbums(albums)];
      this.albumLists[sort] = {
        items: merged,
        loading: false,
        error: undefined,
        offset: offset + albums.length,
        hasMore: option.paginated && albums.length >= pageSize,
        loadedAt: Date.now(),
      };
    } catch (error) {
      const message = describeError(error);
      this.albumLists[sort] = { ...previous, loading: false, error: message };
      this.report(error, message);
    }
  }

  // ---------------------------------------------------------------- artists

  async loadArtistsList(options: { refresh?: boolean } = {}): Promise<void> {
    const key = 'artists';
    if (this.inflight.has(key)) return this.inflight.get(key) as Promise<void>;
    if (!options.refresh && this.artists.loadedAt !== undefined) return;

    const promise = (async () => {
      const client = this.deps.client();
      this.artists = { ...this.artists, loading: true, error: undefined };
      if (!client) {
        this.artists = { ...this.artists, loading: false, error: 'not connected' };
        return;
      }
      try {
        const listing = await client.getArtists();
        this.artists = { listing, loading: false, error: undefined, loadedAt: Date.now() };
      } catch (error) {
        const message = describeError(error);
        this.artists = { ...this.artists, loading: false, error: message };
        this.report(error, message);
      }
    })().finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  // ------------------------------------------------------------------ album

  albumDetail(id: string): AlbumSlice {
    return (
      this.albumDetails[id] ?? {
        album: undefined,
        loading: false,
        error: undefined,
        loadedAt: undefined,
      }
    );
  }

  async loadAlbum(id: string, options: { refresh?: boolean } = {}): Promise<void> {
    const key = `album:${id}`;
    if (this.inflight.has(key)) return this.inflight.get(key) as Promise<void>;
    const current = this.albumDetails[id];
    if (!options.refresh && current?.album && current.loadedAt !== undefined) return;
    if (!id) return;

    const promise = (async () => {
      const client = this.deps.client();
      this.albumDetails[id] = {
        album: current?.album,
        loading: true,
        error: undefined,
        loadedAt: current?.loadedAt,
      };
      if (!client) {
        this.albumDetails[id] = {
          album: undefined,
          loading: false,
          error: 'not connected',
          loadedAt: undefined,
        };
        return;
      }
      try {
        const album = await client.getAlbum(id);
        this.albumDetails[id] = { album, loading: false, error: undefined, loadedAt: Date.now() };
      } catch (error) {
        const message = describeError(error);
        this.albumDetails[id] = {
          album: current?.album,
          loading: false,
          error: message,
          loadedAt: current?.loadedAt,
        };
        this.report(error, message);
      }
    })().finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  // ----------------------------------------------------------------- artist

  artistDetail(id: string): ArtistSlice {
    return this.artistDetails[id] ?? emptyArtistSlice();
  }

  /**
   * Load an artist page. The three sub-resources are fetched concurrently and
   * independently: a missing biography is expected on servers without Last.fm
   * and must not stop albums or top tracks from rendering.
   */
  async loadArtist(id: string, options: { refresh?: boolean } = {}): Promise<void> {
    const key = `artist:${id}`;
    if (this.inflight.has(key)) return this.inflight.get(key) as Promise<void>;
    const current = this.artistDetails[id];
    if (!options.refresh && current?.artist && current.loadedAt !== undefined) return;
    if (!id) return;

    const promise = (async () => {
      const client = this.deps.client();
      this.artistDetails[id] = {
        ...emptyArtistSlice(),
        ...current,
        loading: true,
        error: undefined,
      };
      if (!client) {
        this.artistDetails[id] = { ...emptyArtistSlice(), loading: false, error: 'not connected' };
        return;
      }

      const [artistResult, bioResult] = await Promise.allSettled([
        client.getArtist(id),
        client.getArtistInfo2(id),
      ]);

      if (artistResult.status === 'rejected') {
        const message = describeError(artistResult.reason);
        this.artistDetails[id] = {
          ...emptyArtistSlice(),
          ...current,
          loading: false,
          error: message,
        };
        this.report(artistResult.reason, message);
        return;
      }

      const { artist, albums } = artistResult.value;
      const bio = bioResult.status === 'fulfilled' ? bioResult.value : undefined;
      const bioUnavailable = !bio || (!bio.biography && bio.similarArtists.length === 0);

      this.artistDetails[id] = {
        artist,
        albums,
        topSongs: current?.topSongs ?? [],
        bio,
        bioUnavailable,
        loading: false,
        error: undefined,
        loadedAt: Date.now(),
      };

      // Top songs need the artist *name*, and are optional.
      const topSongs = await this.loadTopSongs(client, artist.name);
      const slice = this.artistDetails[id];
      this.artistDetails[id] = { ...slice, topSongs };
    })().finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  private async loadTopSongs(client: SubsonicClient, artistName: string): Promise<Track[]> {
    try {
      return await client.getTopSongs(artistName, 10);
    } catch {
      return [];
    }
  }

  /** Drop cached detail (after a star toggle, for instance). */
  invalidate(prefix: 'album' | 'artist' | 'list' | 'all', id?: string): void {
    if (prefix === 'all') {
      // Everything: lists, the artist index and both detail caches.
      this.albumLists = {};
      this.artists = { listing: undefined, loading: false, error: undefined, loadedAt: undefined };
      this.albumDetails = {};
      this.artistDetails = {};
      return;
    }
    if (prefix === 'list') {
      this.albumLists = {};
      return;
    }
    if (prefix === 'album' && id) delete this.albumDetails[id];
    if (prefix === 'artist' && id) delete this.artistDetails[id];
  }

  private report(error: unknown, message: string): void {
    if (error instanceof AuthError) return; // handled globally by the connection banner
    this.deps.onError?.(message);
  }
}

function dedupeAlbums(albums: Album[]): Album[] {
  const seen = new Set<string>();
  const out: Album[] = [];
  for (const album of albums) {
    if (seen.has(album.id)) continue;
    seen.add(album.id);
    out.push(album);
  }
  return out;
}
