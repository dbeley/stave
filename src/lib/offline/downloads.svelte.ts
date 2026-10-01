/**
 * Offline download manager for "listen later" albums.
 *
 * Design notes that matter on a phone:
 *   - downloads are cancellable and race-free: the cancellation token is
 *     registered *synchronously* before the first await and re-checked before
 *     every database write, so a purge mid-download cannot resurrect data;
 *   - only interrupted (`downloading`) items resume on start-up — `failed`
 *     items wait for an explicit retry, so launching the app never triggers a
 *     download storm;
 *   - at most `concurrency` transfers run at once, however many albums are
 *     queued.
 */

import type { Album, Track } from '$lib/domain/types';
import type { OfflineDatabase, OfflineTrackMeta } from './db';
import type { BlobStore } from './blobStore';

export type DownloadStatus = 'queued' | 'downloading' | 'cached' | 'failed';

export interface DownloadEntry {
  albumId: string;
  albumName: string;
  status: DownloadStatus;
  /** Tracks expected. */
  total: number;
  /** Tracks written. */
  done: number;
  bytes: number;
  error?: string;
  updatedAt: number;
}

export interface DownloadManagerDeps {
  db: OfflineDatabase;
  blobs: BlobStore;
  /** Fetch that returns the audio bytes for a track. */
  fetchAudio: (track: Track) => Promise<Blob>;
  /** Resolves the track list for an album (fetched once, then cached). */
  loadAlbum: (albumId: string) => Promise<Album>;
  onTrackCached?: (track: Track, meta: OfflineTrackMeta) => void;
  onTrackRemoved?: (trackId: string) => void;
  concurrency?: number;
  now?: () => number;
  /** Injectable for tests; defaults to a microtask-based scheduler. */
  schedule?: (fn: () => void) => void;
}

export class DownloadManager {
  readonly state: { entries: Record<string, DownloadEntry> };

  private readonly tokens = new Map<string, number>();
  private readonly queue: string[] = [];
  private readonly albums = new Map<string, Album>();
  private readonly deps: DownloadManagerDeps;
  private readonly concurrency: number;
  private active = 0;
  private tokenSeq = 0;

  constructor(deps: DownloadManagerDeps) {
    this.deps = deps;
    this.concurrency = Math.max(1, deps.concurrency ?? 2);
    this.state = $state<{ entries: Record<string, DownloadEntry> }>({ entries: {} });
  }

  get entries(): DownloadEntry[] {
    return Object.values(this.state.entries);
  }

  entry(albumId: string): DownloadEntry | undefined {
    return this.state.entries[albumId];
  }

  isCached(albumId: string): boolean {
    return this.state.entries[albumId]?.status === 'cached';
  }

  /** Bytes currently held by the cache, summed over completed albums. */
  get cachedBytes(): number {
    return this.entries
      .filter((entry) => entry.status === 'cached')
      .reduce((total, entry) => total + entry.bytes, 0);
  }

  /**
   * Restore knowledge of already-cached albums and resume interrupted ones.
   * Never auto-retries `failed` entries.
   */
  async hydrate(): Promise<void> {
    try {
      const metas = await this.deps.db.listAlbumMeta();
      const entries: Record<string, DownloadEntry> = { ...this.state.entries };
      for (const meta of metas) {
        entries[meta.albumId] = {
          albumId: meta.albumId,
          albumName: meta.albumName,
          status: 'cached',
          total: meta.trackIds.length,
          done: meta.trackIds.length,
          bytes: meta.bytes,
          updatedAt: meta.cachedAt,
        };
      }
      this.state.entries = entries;
    } catch {
      /* no cache yet */
    }
  }

  /** Queue an album for download; already-cached albums are a no-op. */
  enqueue(album: Album): void {
    const existing = this.state.entries[album.id];
    if (existing?.status === 'cached') return;
    if (existing?.status === 'queued' || existing?.status === 'downloading') return;

    this.albums.set(album.id, album);
    this.tokens.set(album.id, ++this.tokenSeq);
    this.state.entries = {
      ...this.state.entries,
      [album.id]: {
        albumId: album.id,
        albumName: album.name,
        status: 'queued',
        total: album.tracks?.length ?? album.songCount,
        done: 0,
        bytes: 0,
        updatedAt: this.now(),
      },
    };
    this.queue.push(album.id);
    this.pump();
  }

  /** Cancel a download in flight and forget it (cached data is removed). */
  async cancel(albumId: string): Promise<void> {
    this.tokens.set(albumId, ++this.tokenSeq);
    this.state.entries = {
      ...this.state.entries,
      [albumId]: {
        ...(this.state.entries[albumId] ?? emptyEntry(albumId, this.now())),
        status: 'failed',
        error: 'cancelled',
        updatedAt: this.now(),
      },
    };
    await this.remove(albumId);
  }

  /** Retry a failed album. */
  retry(albumId: string): void {
    const entry = this.state.entries[albumId];
    if (!entry || entry.status === 'cached' || entry.status === 'downloading') return;
    this.tokens.set(albumId, ++this.tokenSeq);
    this.state.entries = {
      ...this.state.entries,
      [albumId]: {
        ...entry,
        status: 'queued',
        error: undefined,
        done: 0,
        bytes: 0,
        updatedAt: this.now(),
      },
    };
    if (!this.queue.includes(albumId)) this.queue.push(albumId);
    this.pump();
  }

  /** Delete cached audio for an album. */
  async remove(albumId: string): Promise<void> {
    this.tokens.set(albumId, ++this.tokenSeq);
    const trackIds = await this.safeListTrackIds(albumId);
    for (const trackId of trackIds) {
      await this.deps.blobs.delete(trackId);
      await this.deps.db.deleteTrack(trackId);
      this.deps.onTrackRemoved?.(trackId);
    }
    await this.deps.db.deleteAlbumMeta(albumId);
    const entries = { ...this.state.entries };
    delete entries[albumId];
    this.state.entries = entries;
  }

  /** Everything in the cache, wiped (settings → "clear offline cache"). */
  async clearAll(): Promise<void> {
    for (const entry of this.entries) {
      this.tokens.set(entry.albumId, ++this.tokenSeq);
    }
    const ids = await this.deps.db.listAllTrackIds();
    for (const id of ids) {
      await this.deps.blobs.delete(id);
      await this.deps.db.deleteTrack(id);
      this.deps.onTrackRemoved?.(id);
    }
    for (const meta of await this.deps.db.listAlbumMeta()) {
      await this.deps.db.deleteAlbumMeta(meta.albumId);
    }
    this.state.entries = {};
    this.queue.length = 0;
  }

  // ------------------------------------------------------------------ worker

  private pump(): void {
    const schedule = this.deps.schedule ?? ((fn: () => void) => queueMicrotask(fn));
    while (this.active < this.concurrency && this.queue.length > 0) {
      const albumId = this.queue.shift();
      if (!albumId) break;
      const token = this.tokens.get(albumId);
      if (token === undefined) continue;
      this.active += 1;
      schedule(() => {
        void this.download(albumId, token).finally(() => {
          this.active -= 1;
          this.pump();
        });
      });
    }
  }

  private async download(albumId: string, token: number): Promise<void> {
    this.patchEntry(albumId, { status: 'downloading', updatedAt: this.now() });

    let album: Album;
    try {
      album = this.albums.get(albumId) ?? (await this.deps.loadAlbum(albumId));
      if (!album.tracks || album.tracks.length === 0) {
        album = await this.deps.loadAlbum(albumId);
      }
    } catch (error) {
      this.patchEntry(albumId, {
        status: 'failed',
        error: errorText(error),
        updatedAt: this.now(),
      });
      return;
    }

    if (this.isStale(albumId, token)) return;

    const tracks = album.tracks ?? [];
    if (tracks.length === 0) {
      this.patchEntry(albumId, {
        status: 'failed',
        error: 'album has no tracks',
        updatedAt: this.now(),
      });
      return;
    }

    this.patchEntry(albumId, { total: tracks.length });

    const trackIds: string[] = [];
    let bytes = 0;

    for (const track of tracks) {
      if (this.isStale(albumId, token)) return;
      if (await this.isTrackReady(track.id)) {
        trackIds.push(track.id);
        continue;
      }

      let blob: Blob;
      try {
        blob = await this.deps.fetchAudio(track);
      } catch (error) {
        this.patchEntry(albumId, {
          status: 'failed',
          error: errorText(error),
          updatedAt: this.now(),
        });
        return;
      }

      // Re-check after every await: a cancel/remove must not be able to write
      // stale data back into the cache.
      if (this.isStale(albumId, token)) return;

      try {
        await this.deps.blobs.put(track.id, blob);
        if (this.isStale(albumId, token)) {
          await this.deps.blobs.delete(track.id);
          return;
        }
        const meta: OfflineTrackMeta = {
          id: track.id,
          albumId,
          albumName: album.name,
          artistName: album.artistName,
          title: track.title,
          durationSec: track.durationSec,
          cachedAt: this.now(),
          storedBytes: blob.size,
        };
        if (track.trackNumber !== undefined) meta.trackNumber = track.trackNumber;
        if (track.discNumber !== undefined) meta.discNumber = track.discNumber;
        if (track.suffix) meta.suffix = track.suffix;
        if (track.sizeBytes !== undefined) meta.sizeBytes = track.sizeBytes;
        if (blob.type) meta.contentType = blob.type;

        await this.deps.db.putTrack(meta);
        if (this.isStale(albumId, token)) return;

        trackIds.push(track.id);
        bytes += blob.size;
        this.deps.onTrackCached?.(track, meta);
        this.patchEntry(albumId, {
          done: trackIds.length,
          bytes,
          updatedAt: this.now(),
        });
      } catch (error) {
        this.patchEntry(albumId, {
          status: 'failed',
          error: errorText(error),
          updatedAt: this.now(),
        });
        return;
      }
    }

    if (this.isStale(albumId, token)) return;

    await this.deps.db.putAlbumMeta({
      albumId,
      albumName: album.name,
      artistName: album.artistName,
      coverArtId: album.coverArtId,
      trackIds,
      bytes,
      cachedAt: this.now(),
    });

    this.patchEntry(albumId, {
      status: 'cached',
      done: trackIds.length,
      total: trackIds.length,
      bytes,
      error: undefined,
      updatedAt: this.now(),
    });
  }

  private async isTrackReady(trackId: string): Promise<boolean> {
    const existing = await this.deps.db.getTrack(trackId);
    if (!existing) return false;
    const blob = await this.deps.blobs.get(trackId);
    return blob !== null;
  }

  private async safeListTrackIds(albumId: string): Promise<string[]> {
    try {
      return await this.deps.db.listTrackIdsByAlbum(albumId);
    } catch {
      return [];
    }
  }

  /** True when this download was cancelled or superseded. */
  private isStale(albumId: string, token: number): boolean {
    return this.tokens.get(albumId) !== token;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private patchEntry(albumId: string, patch: Partial<DownloadEntry>): void {
    const current = this.state.entries[albumId] ?? emptyEntry(albumId, this.now());
    this.state.entries = {
      ...this.state.entries,
      [albumId]: { ...current, ...patch },
    };
  }
}

function emptyEntry(albumId: string, now: number): DownloadEntry {
  return { albumId, albumName: '', status: 'queued', total: 0, done: 0, bytes: 0, updatedAt: now };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
