/**
 * Where offline audio physically lives.
 *
 * `IdbBlobStore` is used on the web PWA; `NativeFileStore` puts files in the
 * Capacitor app data directory on Android, which survives WebView cache purges
 * and does not count against the (much smaller) browser quota.
 */

import type { OfflineDatabase } from './db';

export interface BlobStore {
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | null>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export class IdbBlobStore implements BlobStore {
  constructor(private readonly db: OfflineDatabase) {}

  put(key: string, blob: Blob): Promise<void> {
    return this.db.putBlob(key, blob);
  }

  get(key: string): Promise<Blob | null> {
    return this.db.getBlob(key);
  }

  delete(key: string): Promise<void> {
    return this.db.deleteBlob(key);
  }

  keys(): Promise<string[]> {
    return this.db.listBlobKeys();
  }
}

/** Cap of `btoa`-friendly chunks; larger strings blow the argument limit. */
const BASE64_CHUNK = 0x8000;

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < buffer.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(offset, offset + BASE64_CHUNK));
  }
  return btoa(binary);
}

export function base64ToBlob(base64: string, contentType = 'audio/mpeg'): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

export interface FilesystemLike {
  writeFile(options: {
    path: string;
    directory: string;
    data: string;
    recursive?: boolean;
  }): Promise<unknown>;
  readFile(options: { path: string; directory: string }): Promise<{ data: string }>;
  deleteFile(options: { path: string; directory: string }): Promise<void>;
  readdir(options: { path: string; directory: string }): Promise<{ files: { name: string }[] }>;
  mkdir(options: { path: string; directory: string; recursive?: boolean }): Promise<void>;
}

/**
 * Capacitor Filesystem-backed store.
 *
 * The Capacitor module is imported lazily so nothing in the web bundle (or in
 * tests) depends on the native runtime being present.
 */
export class NativeFileStore implements BlobStore {
  constructor(
    private readonly directory: string = 'offline',
    private readonly loadFilesystem: () => Promise<{
      Filesystem: FilesystemLike;
      Directory: { Data: string };
    }> = defaultFilesystemLoader,
    private readonly dataDirectory: string = 'DATA',
  ) {}

  private async fs(): Promise<{ Filesystem: FilesystemLike; directory: string }> {
    const mod = await this.loadFilesystem();
    return { Filesystem: mod.Filesystem, directory: this.dataDirectory || mod.Directory.Data };
  }

  private pathFor(key: string): string {
    // Keys are track ids; keep them filesystem-safe.
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${this.directory}/${safe}`;
  }

  async put(key: string, blob: Blob): Promise<void> {
    const { Filesystem, directory } = await this.fs();
    await Filesystem.mkdir({ path: this.directory, directory, recursive: true }).catch(() => {});
    await Filesystem.writeFile({
      path: this.pathFor(key),
      directory,
      data: await blobToBase64(blob),
      recursive: true,
    });
  }

  async get(key: string): Promise<Blob | null> {
    const { Filesystem, directory } = await this.fs();
    try {
      const result = await Filesystem.readFile({ path: this.pathFor(key), directory });
      return base64ToBlob(result.data);
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const { Filesystem, directory } = await this.fs();
    await Filesystem.deleteFile({ path: this.pathFor(key), directory }).catch(() => {});
  }

  async keys(): Promise<string[]> {
    const { Filesystem, directory } = await this.fs();
    try {
      const result = await Filesystem.readdir({ path: this.directory, directory });
      return result.files.map((file) => file.name);
    } catch {
      return [];
    }
  }
}

async function defaultFilesystemLoader(): Promise<{
  Filesystem: FilesystemLike;
  Directory: { Data: string };
}> {
  const mod = (await import('@capacitor/filesystem')) as unknown as {
    Filesystem: FilesystemLike;
    Directory: { Data: string };
  };
  return { Filesystem: mod.Filesystem, Directory: mod.Directory };
}

/** In-memory store: used by tests and as a last-resort fallback. */
export class MemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, Blob>();

  async put(key: string, blob: Blob): Promise<void> {
    this.blobs.set(key, blob);
  }

  async get(key: string): Promise<Blob | null> {
    return this.blobs.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.blobs.keys()];
  }
}
