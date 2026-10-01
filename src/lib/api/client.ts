/**
 * The Subsonic REST client.
 *
 * Responsibilities, and nothing else:
 *   - authenticate with the token scheme (`t = md5(password + salt)`),
 *   - build URLs (including the ones handed to <img>/<audio>),
 *   - turn wire payloads into domain objects,
 *   - surface typed errors the UI can react to.
 *
 * Everything is injectable (fetch, clock, cache, salt source) so the whole
 * class is testable without a network or a real server.
 */

import { API_VERSION, CLIENT_NAME } from '$lib/config';
import type { AlbumListType } from '$lib/api/endpoints';
import type {
  Album,
  ArtistAlbums,
  ArtistBio,
  ArtistsListing,
  Playlist,
  SearchResults,
  ServerInfo,
  StarredResults,
  Track,
} from '$lib/domain/types';
import { ResponseCache } from './cache';
import { ENDPOINTS, SUBSONIC_ERROR } from './endpoints';
import {
  AuthError,
  NetworkError,
  ProtocolError,
  RequestTimeoutError,
  SubsonicError,
} from './errors';
import { md5 } from './md5';
import {
  asArray,
  sortTracks,
  toAlbum,
  toArtist,
  toArtistBio,
  toArtistsListing,
  toPlaylist,
  toStarred,
  toTrack,
} from './normalize';
import type {
  AlbumListPayload,
  ArtistInfo2,
  ArtistID3,
  ArtistsPayload,
  Child,
  PlaylistsPayload,
  RandomSongsPayload,
  SearchPayload,
  SimilarSongsPayload,
  StarredPayload,
  SubsonicEnvelope,
  SubsonicResponse,
  TopSongsPayload,
} from './types';

export interface Credentials {
  server: string;
  username: string;
  password: string;
}

export interface SubsonicClientOptions extends Credentials {
  clientName?: string;
  apiVersion?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  cache?: ResponseCache | null;
  /** Overridable for deterministic tests. */
  saltFactory?: () => string;
}

export interface StreamOptions {
  /** 0 or undefined = no transcoding. */
  maxBitRate?: number;
  format?: string;
}

export type QueryValue = string | number | boolean | undefined | null;

const DEFAULT_TIMEOUT_MS = 15000;

/** Strip trailing slashes and add a scheme when the user forgot one. */
export function normalizeServerUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

export function normalizeCredentials(credentials: Credentials): Credentials {
  return {
    server: normalizeServerUrl(credentials.server),
    username: credentials.username.trim(),
    password: credentials.password,
  };
}

export class SubsonicClient {
  readonly server: string;
  readonly username: string;
  readonly password: string;
  readonly clientName: string;
  readonly apiVersion: string;
  readonly timeoutMs: number;

  private readonly fetchImpl: typeof fetch;
  private readonly cache: ResponseCache | null;
  private readonly saltFactory: () => string;

  constructor(options: SubsonicClientOptions) {
    const normalized = normalizeCredentials(options);
    this.server = normalized.server;
    this.username = normalized.username;
    this.password = normalized.password;
    this.clientName = options.clientName ?? CLIENT_NAME;
    this.apiVersion = options.apiVersion ?? API_VERSION;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.cache = options.cache === undefined ? new ResponseCache() : options.cache;
    this.saltFactory = options.saltFactory ?? defaultSalt;
  }

  // ---------------------------------------------------------------- plumbing

  /** Cache namespace: two servers/users must never share metadata. */
  private get cachePrefix(): string {
    return `${this.server}|${this.username}|`;
  }

  private buildAuthParams(salt: string): URLSearchParams {
    const params = new URLSearchParams();
    params.set('u', this.username);
    params.set('t', md5(`${this.password}${salt}`));
    params.set('s', salt);
    params.set('v', this.apiVersion);
    params.set('c', this.clientName);
    params.set('f', 'json');
    return params;
  }

  private buildQuery(params: Record<string, QueryValue>, salt = this.saltFactory()): string {
    const search = this.buildAuthParams(salt);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      search.set(key, String(value));
    }
    return search.toString();
  }

  /** Full request URL. Public: tests and debugging use it. */
  buildUrl(endpoint: string, params: Record<string, QueryValue> = {}): string {
    return `${this.server}/rest/${endpoint}?${this.buildQuery(params)}`;
  }

  /** URL for cover art, suitable for an <img src>. */
  coverArtUrl(id: string, size?: number): string {
    return this.buildUrl(ENDPOINTS.getCoverArt, { id, size });
  }

  /** URL for streaming, suitable for <audio src>. */
  streamUrl(id: string, options: StreamOptions = {}): string {
    return this.buildUrl(ENDPOINTS.stream, {
      id,
      maxBitRate: options.maxBitRate && options.maxBitRate > 0 ? options.maxBitRate : undefined,
      format: options.format,
    });
  }

  /** URL for a raw file download (used by the offline cache on native). */
  downloadUrl(id: string): string {
    return this.buildUrl(ENDPOINTS.download, { id });
  }

  /** Absolute URL written into MediaSession / notification metadata. */
  publicUrl(url: string): string {
    try {
      return new URL(url, this.server).toString();
    } catch {
      return url;
    }
  }

  // ----------------------------------------------------------------- requests

  /** Perform a request and return the `subsonic-response` payload. */
  async requestRaw(
    endpoint: string,
    params: Record<string, QueryValue> = {},
  ): Promise<SubsonicResponse> {
    const url = this.buildUrl(endpoint, params);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new RequestTimeoutError(`Request timed out after ${this.timeoutMs}ms`, error);
      }
      throw new NetworkError(`Cannot reach ${this.server}`, error);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthError(`Server refused the credentials (HTTP ${response.status})`);
    }
    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    let envelope: SubsonicEnvelope;
    try {
      envelope = JSON.parse(text) as SubsonicEnvelope;
    } catch {
      throw new ProtocolError(
        `${endpoint}: server did not return JSON (is this a Subsonic server?) — ${text.slice(0, 120)}`,
      );
    }

    const payload = envelope['subsonic-response'];
    if (!payload || typeof payload !== 'object') {
      throw new ProtocolError(`${endpoint}: malformed Subsonic response`);
    }
    if (payload.status === 'failed') {
      const code = payload.error?.code ?? SUBSONIC_ERROR.GENERIC;
      const message = payload.error?.message ?? `Subsonic error ${code}`;
      if (
        code === SUBSONIC_ERROR.WRONG_CREDENTIALS ||
        code === SUBSONIC_ERROR.TOKEN_AUTH_NOT_SUPPORTED
      ) {
        throw new AuthError(message);
      }
      throw new SubsonicError(message, code);
    }
    return payload;
  }

  /**
   * Request + decode, with optional caching.
   * `cacheMs = 0` bypasses the cache entirely.
   */
  private async request<T>(
    endpoint: string,
    params: Record<string, QueryValue>,
    decode: (payload: SubsonicResponse) => T,
    cacheMs: number,
  ): Promise<T> {
    const key = `${this.cachePrefix}${endpoint}?${canonicalParams(params)}`;

    if (this.cache && cacheMs > 0) {
      const hit = this.cache.get<T>(key);
      if (hit !== undefined) return hit;
    }

    const payload = await this.requestRaw(endpoint, params);
    const value = decode(payload);

    if (this.cache && cacheMs > 0) this.cache.set(key, value, cacheMs);
    return value;
  }

  /** Drop cached responses; call after any mutation. */
  invalidate(...endpoints: string[]): void {
    if (!this.cache) return;
    if (endpoints.length === 0) {
      this.cache.invalidate(this.cachePrefix);
      return;
    }
    this.cache.invalidate(...endpoints.map((endpoint) => `${this.cachePrefix}${endpoint}`));
  }

  // -------------------------------------------------------------------- API

  async ping(): Promise<ServerInfo> {
    const payload = await this.requestRaw(ENDPOINTS.ping);
    return {
      version: typeof payload.version === 'string' ? payload.version : undefined,
      serverVersion: typeof payload.serverVersion === 'string' ? payload.serverVersion : undefined,
      type: typeof payload.type === 'string' ? payload.type : undefined,
      openSubsonic: payload.openSubsonic === true,
    };
  }

  async getAlbumList(params: {
    type: AlbumListType;
    size?: number;
    offset?: number;
    genre?: string;
    fromYear?: number;
    toYear?: number;
  }): Promise<Album[]> {
    return this.request(
      ENDPOINTS.getAlbumList2,
      {
        type: params.type,
        size: params.size ?? 20,
        offset: params.offset ?? 0,
        genre: params.genre,
        fromYear: params.fromYear,
        toYear: params.toYear,
      },
      (payload) => {
        const list = payload as unknown as AlbumListPayload;
        const albums = asArray(list.albumList2?.album ?? list.albumList?.album);
        return albums.map(toAlbum);
      },
      5 * 60 * 1000,
    );
  }

  async getAlbum(id: string): Promise<Album> {
    return this.request(
      ENDPOINTS.getAlbum,
      { id },
      (payload) => {
        const album = payload.album as Parameters<typeof toAlbum>[0] | undefined;
        if (!album) throw new ProtocolError('getAlbum: response contained no album');
        const mapped = toAlbum(album);
        if (mapped.tracks) mapped.tracks = sortTracks(mapped.tracks);
        return mapped;
      },
      5 * 60 * 1000,
    );
  }

  async getArtists(): Promise<ArtistsListing> {
    return this.request(
      ENDPOINTS.getArtists,
      {},
      (payload) => {
        const artists = (payload as unknown as ArtistsPayload).artists;
        return toArtistsListing(artists ?? {});
      },
      10 * 60 * 1000,
    );
  }

  async getArtist(id: string): Promise<ArtistAlbums> {
    return this.request(
      ENDPOINTS.getArtist,
      { id },
      (payload) => {
        const artist = payload.artist as
          (ArtistID3 & { album?: Parameters<typeof toAlbum>[0][] }) | undefined;
        if (!artist) throw new ProtocolError('getArtist: response contained no artist');
        const mapped: ArtistAlbums = {
          artist: toArtist(artist),
          albums: asArray(artist.album).map(toAlbum),
        };
        mapped.albums.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
        return mapped;
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Biography + similar artists. Servers without Last.fm configured return an
   * empty payload (still `status: ok`), which the UI degrades from gracefully.
   */
  async getArtistInfo2(id: string, count = 20): Promise<ArtistBio> {
    return this.request(
      ENDPOINTS.getArtistInfo2,
      { id, count },
      (payload) => toArtistBio(payload.artistInfo2 as ArtistInfo2 | undefined),
      10 * 60 * 1000,
    );
  }

  async getTopSongs(artistName: string, count = 20): Promise<Track[]> {
    return this.request(
      ENDPOINTS.getTopSongs,
      { artist: artistName, count },
      (payload) => {
        const songs = (payload as unknown as TopSongsPayload).topSongs?.song;
        return asArray(songs).map(toTrack);
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Similar songs for the auto-DJ. Tries the ID3 endpoint first, then the
   * legacy one for older servers. Throws only if both are unavailable — the
   * auto-DJ treats that as "use local heuristics" rather than failing.
   */
  async getSimilarSongs(id: string, count = 50): Promise<Track[]> {
    try {
      return await this.request(
        ENDPOINTS.getSimilarSongs2,
        { id, count },
        (payload) => {
          const songs = (payload as unknown as SimilarSongsPayload).similarSongs2?.song;
          return asArray(songs).map(toTrack);
        },
        2 * 60 * 1000,
      );
    } catch (error) {
      if (error instanceof AuthError) throw error;
      return this.request(
        ENDPOINTS.getSimilarSongs,
        { id, count },
        (payload) => {
          const songs = (payload as unknown as SimilarSongsPayload).similarSongs?.song;
          return asArray(songs).map(toTrack);
        },
        2 * 60 * 1000,
      );
    }
  }

  async getRandomSongs(
    params: {
      size?: number;
      genre?: string;
      fromYear?: number;
      toYear?: number;
    } = {},
  ): Promise<Track[]> {
    return this.request(
      ENDPOINTS.getRandomSongs,
      {
        size: params.size ?? 50,
        genre: params.genre,
        fromYear: params.fromYear,
        toYear: params.toYear,
      },
      (payload) => {
        const songs = (payload as unknown as RandomSongsPayload).randomSongs?.song;
        return asArray(songs).map(toTrack);
      },
      0,
    );
  }

  async search3(
    query: string,
    params: { artistCount?: number; albumCount?: number; songCount?: number } = {},
  ): Promise<SearchResults> {
    return this.request(
      ENDPOINTS.search3,
      {
        query,
        artistCount: params.artistCount ?? 20,
        albumCount: params.albumCount ?? 20,
        songCount: params.songCount ?? 40,
      },
      (payload) => {
        const result =
          (payload as unknown as SearchPayload).searchResult3 ??
          (payload as unknown as SearchPayload).searchResult2;
        return {
          artists: asArray(result?.artist).map(toArtist),
          albums: asArray(result?.album).map(toAlbum),
          tracks: asArray(result?.song).map(toTrack),
        };
      },
      60 * 1000,
    );
  }

  async getPlaylists(): Promise<Playlist[]> {
    return this.request(
      ENDPOINTS.getPlaylists,
      {},
      (payload) => {
        const playlists = (payload as unknown as PlaylistsPayload).playlists?.playlist;
        return asArray(playlists).map(toPlaylist);
      },
      2 * 60 * 1000,
    );
  }

  async getPlaylist(id: string): Promise<Playlist> {
    return this.request(
      ENDPOINTS.getPlaylist,
      { id },
      (payload) => {
        const playlist = payload.playlist as Parameters<typeof toPlaylist>[0] | undefined;
        if (!playlist) throw new ProtocolError('getPlaylist: response contained no playlist');
        return toPlaylist(playlist);
      },
      2 * 60 * 1000,
    );
  }

  async getStarred(): Promise<StarredResults> {
    return this.request(
      ENDPOINTS.getStarred2,
      {},
      (payload) => {
        const starred =
          (payload as unknown as StarredPayload).starred2 ??
          (payload as unknown as StarredPayload).starred;
        return toStarred(starred ?? {});
      },
      2 * 60 * 1000,
    );
  }

  async star(params: { id?: string; albumId?: string; artistId?: string }): Promise<void> {
    if (!params.id && !params.albumId && !params.artistId) {
      throw new SubsonicError('star: nothing to star');
    }
    await this.requestRaw(ENDPOINTS.star, params);
    this.invalidate(ENDPOINTS.getStarred2, ENDPOINTS.getAlbumList2);
  }

  async unstar(params: { id?: string; albumId?: string; artistId?: string }): Promise<void> {
    if (!params.id && !params.albumId && !params.artistId) {
      throw new SubsonicError('unstar: nothing to unstar');
    }
    await this.requestRaw(ENDPOINTS.unstar, params);
    this.invalidate(ENDPOINTS.getStarred2, ENDPOINTS.getAlbumList2);
  }

  /**
   * Report playback. `submission: false` only marks the track as "now playing";
   * `true` scrobbles it. Sent as 1/0 because that is what real servers parse.
   */
  async scrobble(params: { id: string; time?: number; submission?: boolean }): Promise<void> {
    await this.requestRaw(ENDPOINTS.scrobble, {
      id: params.id,
      time: params.time ?? Math.floor(Date.now() / 1000),
      submission: params.submission === false ? 0 : 1,
    });
  }

  /** Track by id, used by auto-DJ to resolve candidates. */
  async getSimilarSongsSafe(id: string, count = 50): Promise<Track[]> {
    try {
      return await this.getSimilarSongs(id, count);
    } catch {
      return [];
    }
  }
}

function canonicalParams(params: Record<string, QueryValue>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');
}

function defaultSalt(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(8);
    cryptoObj.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2, 12).padEnd(10, '0');
}

export type { Child };
