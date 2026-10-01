/**
 * The offline cache database.
 *
 * Two stores, deliberately kept apart:
 *   - `tracks`: small metadata rows, one per cached track (indexed by albumId),
 *   - `blobs`:  the audio itself, keyed by track id.
 *
 * The split matters: metadata can be listed cheaply, while blobs must never be
 * bulk-loaded (reading a store full of ArrayBuffers into the JS heap is what
 * makes a mobile WebView crawl and eventually die). Every presence check in the
 * app goes through key-only queries.
 */

export const DB_NAME = 'stave-offline';
/** Bump together with a new `onupgradeneeded` branch. */
export const DB_VERSION = 1;

export const STORE_TRACKS = 'tracks';
export const STORE_BLOBS = 'blobs';

export interface OfflineTrackMeta {
  /** Subsonic song id. */
  id: string;
  albumId: string;
  albumName?: string;
  artistName?: string;
  title: string;
  trackNumber?: number;
  discNumber?: number;
  durationSec: number;
  suffix?: string;
  contentType?: string;
  sizeBytes?: number;
  /** Bytes actually stored (may differ from sizeBytes after transcoding). */
  storedBytes?: number;
  cachedAt: number;
}

export interface OfflineAlbumMeta {
  albumId: string;
  albumName: string;
  artistName?: string;
  coverArtId?: string;
  trackIds: string[];
  bytes: number;
  cachedAt: number;
}

/** The subset of the DB the app talks to — easy to fake in tests. */
export interface OfflineDatabase {
  putTrack(meta: OfflineTrackMeta): Promise<void>;
  getTrack(id: string): Promise<OfflineTrackMeta | null>;
  /** Primary keys only — never loads the blobs. */
  listTrackIdsByAlbum(albumId: string): Promise<string[]>;
  listAllTrackIds(): Promise<string[]>;
  deleteTrack(id: string): Promise<void>;
  deleteAlbum(albumId: string): Promise<void>;

  putBlob(key: string, blob: Blob): Promise<void>;
  getBlob(key: string): Promise<Blob | null>;
  deleteBlob(key: string): Promise<void>;
  listBlobKeys(): Promise<string[]>;

  putAlbumMeta(meta: OfflineAlbumMeta): Promise<void>;
  getAlbumMeta(albumId: string): Promise<OfflineAlbumMeta | null>;
  listAlbumMeta(): Promise<OfflineAlbumMeta[]>;
  deleteAlbumMeta(albumId: string): Promise<void>;

  clear(): Promise<void>;
}

export interface OfflineDbOptions {
  factory?: IDBFactory | null;
  name?: string;
  version?: number;
}

export class IndexedDbOfflineDatabase implements OfflineDatabase {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly factory: IDBFactory | null;
  private readonly name: string;
  private readonly version: number;

  constructor(options: OfflineDbOptions = {}) {
    this.factory = options.factory === undefined ? (globalThis.indexedDB ?? null) : options.factory;
    this.name = options.name ?? DB_NAME;
    this.version = options.version ?? DB_VERSION;
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    const factory = this.factory;
    if (!factory) return Promise.reject(new Error('IndexedDB is not available'));

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(this.name, this.version);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_TRACKS)) {
          const tracks = db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
          // Per-album queries must use the index, not a full-store scan.
          tracks.createIndex('albumId', 'albumId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_BLOBS)) {
          db.createObjectStore(STORE_BLOBS);
        }
        if (!db.objectStoreNames.contains('albums')) {
          db.createObjectStore('albums', { keyPath: 'albumId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
    });

    return this.dbPromise;
  }

  private async withStore<T>(
    storeName: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const request = run(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error(`${storeName} request failed`));
      transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
    });
  }

  async putTrack(meta: OfflineTrackMeta): Promise<void> {
    await this.withStore(
      STORE_TRACKS,
      'readwrite',
      (store) => store.put(meta) as IDBRequest<IDBValidKey>,
    );
  }

  async getTrack(id: string): Promise<OfflineTrackMeta | null> {
    const value = await this.withStore<OfflineTrackMeta | undefined>(
      STORE_TRACKS,
      'readonly',
      (store) => store.get(id) as IDBRequest<OfflineTrackMeta | undefined>,
    );
    return value ?? null;
  }

  async listTrackIdsByAlbum(albumId: string): Promise<string[]> {
    const db = await this.open();
    return new Promise<string[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_TRACKS, 'readonly');
      const index = transaction.objectStore(STORE_TRACKS).index('albumId');
      // getAllKeys on the index returns the primary keys only: no metadata, and
      // certainly no blobs, ever enter memory.
      const request = index.getAllKeys(IDBKeyRange.only(albumId));
      request.onsuccess = () => resolve(request.result.map(String));
      request.onerror = () => reject(request.error ?? new Error('album index query failed'));
    });
  }

  async listAllTrackIds(): Promise<string[]> {
    const keys = await this.withStore<IDBValidKey[]>(STORE_TRACKS, 'readonly', (store) =>
      store.getAllKeys(),
    );
    return keys.map(String);
  }

  async deleteTrack(id: string): Promise<void> {
    await this.withStore(STORE_TRACKS, 'readwrite', (store) => store.delete(id));
  }

  async deleteAlbum(albumId: string): Promise<void> {
    const ids = await this.listTrackIdsByAlbum(albumId);
    for (const id of ids) {
      await this.deleteTrack(id);
      await this.deleteBlob(id);
    }
    await this.deleteAlbumMeta(albumId);
  }

  async putBlob(key: string, blob: Blob): Promise<void> {
    await this.withStore(
      STORE_BLOBS,
      'readwrite',
      (store) => store.put(blob, key) as IDBRequest<IDBValidKey>,
    );
  }

  async getBlob(key: string): Promise<Blob | null> {
    const value = await this.withStore<Blob | undefined>(
      STORE_BLOBS,
      'readonly',
      (store) => store.get(key) as IDBRequest<Blob | undefined>,
    );
    return value ?? null;
  }

  async deleteBlob(key: string): Promise<void> {
    await this.withStore(STORE_BLOBS, 'readwrite', (store) => store.delete(key));
  }

  async listBlobKeys(): Promise<string[]> {
    const keys = await this.withStore<IDBValidKey[]>(STORE_BLOBS, 'readonly', (store) =>
      store.getAllKeys(),
    );
    return keys.map(String);
  }

  async putAlbumMeta(meta: OfflineAlbumMeta): Promise<void> {
    await this.withStore(
      'albums',
      'readwrite',
      (store) => store.put(meta) as IDBRequest<IDBValidKey>,
    );
  }

  async getAlbumMeta(albumId: string): Promise<OfflineAlbumMeta | null> {
    const value = await this.withStore<OfflineAlbumMeta | undefined>(
      'albums',
      'readonly',
      (store) => store.get(albumId) as IDBRequest<OfflineAlbumMeta | undefined>,
    );
    return value ?? null;
  }

  async listAlbumMeta(): Promise<OfflineAlbumMeta[]> {
    const values = await this.withStore<OfflineAlbumMeta[]>('albums', 'readonly', (store) =>
      store.getAll(),
    );
    return values ?? [];
  }

  async deleteAlbumMeta(albumId: string): Promise<void> {
    await this.withStore('albums', 'readwrite', (store) => store.delete(albumId));
  }

  async clear(): Promise<void> {
    for (const store of [STORE_TRACKS, STORE_BLOBS, 'albums']) {
      const keys = await this.withStore<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys());
      for (const key of keys) {
        await this.withStore(store, 'readwrite', (s) => s.delete(key as IDBValidKey));
      }
    }
  }

  close(): void {
    const promise = this.dbPromise;
    this.dbPromise = null;
    void promise?.then((db) => db.close()).catch(() => {});
  }
}
