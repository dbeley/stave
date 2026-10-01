import { describe, it, expect, afterEach } from 'vitest';
import {
  IdbBlobStore,
  MemoryBlobStore,
  NativeFileStore,
  base64ToBlob,
  blobToBase64,
  type FilesystemLike,
} from '$lib/offline/blobStore';
import { audioBlob, blobBytes, closeOpenedDbs, freshDb } from './helpers';

afterEach(() => {
  closeOpenedDbs();
});

describe('IdbBlobStore', () => {
  it('delegates put/get/delete/keys to the database', async () => {
    const db = freshDb();
    const store = new IdbBlobStore(db);

    expect(await store.keys()).toEqual([]);
    expect(await store.get('t1')).toBeNull();

    await store.put('t1', audioBlob([1, 2, 3]));
    await store.put('t2', audioBlob([4, 5]));

    expect(await blobBytes((await store.get('t1'))!)).toEqual([1, 2, 3]);
    expect((await store.keys()).sort()).toEqual(['t1', 't2']);

    await store.delete('t1');
    expect(await store.get('t1')).toBeNull();
    expect(await store.keys()).toEqual(['t2']);
  });

  it('writes through to the underlying blob store', async () => {
    const db = freshDb();
    const store = new IdbBlobStore(db);
    await store.put('t9', audioBlob([9]));
    // The database itself must see the row (no shadow copy in the wrapper).
    expect(await blobBytes((await db.getBlob('t9'))!)).toEqual([9]);
  });
});

describe('MemoryBlobStore', () => {
  it('stores, reads and deletes blobs', async () => {
    const store = new MemoryBlobStore();
    expect(await store.get('k')).toBeNull();
    await store.put('k', audioBlob([7, 8]));
    expect(await blobBytes((await store.get('k'))!)).toEqual([7, 8]);
    expect(await store.keys()).toEqual(['k']);
    await store.delete('k');
    expect(await store.get('k')).toBeNull();
    expect(await store.keys()).toEqual([]);
  });
});

/** Records the calls a NativeFileStore makes, without touching a real filesystem. */
class FakeFilesystem implements FilesystemLike {
  readonly files = new Map<string, string>();
  readonly writes: { path: string; directory: string; data: string }[] = [];
  readonly mkdirs: string[] = [];
  directoryReadError: Error | null = null;

  async writeFile(options: { path: string; directory: string; data: string }): Promise<unknown> {
    this.writes.push({ ...options });
    this.files.set(options.path, options.data);
    return {};
  }

  async readFile(options: { path: string }): Promise<{ data: string }> {
    const data = this.files.get(options.path);
    if (data === undefined) throw new Error(`ENOENT: ${options.path}`);
    return { data };
  }

  async deleteFile(options: { path: string }): Promise<void> {
    if (!this.files.delete(options.path)) throw new Error(`ENOENT: ${options.path}`);
  }

  async readdir(options: { path: string }): Promise<{ files: { name: string }[] }> {
    if (this.directoryReadError) throw this.directoryReadError;
    const prefix = `${options.path}/`;
    return {
      files: [...this.files.keys()]
        .filter((path) => path.startsWith(prefix))
        .map((path) => ({ name: path.slice(prefix.length) })),
    };
  }

  async mkdir(options: { path: string }): Promise<void> {
    this.mkdirs.push(options.path);
  }
}

function nativeStore(fs = new FakeFilesystem(), dataDirectory = 'DATA') {
  return {
    fs,
    store: new NativeFileStore(
      'offline',
      async () => ({ Filesystem: fs, Directory: { Data: 'DATA' } }),
      dataDirectory,
    ),
  };
}

describe('NativeFileStore', () => {
  it('creates its directory and writes base64 audio under a sanitised path', async () => {
    const { fs, store } = nativeStore();
    await store.put('a/b c?.mp3', audioBlob([1, 2, 3]));

    expect(fs.mkdirs).toContain('offline');
    expect(fs.writes).toHaveLength(1);
    expect(fs.writes[0]!.path).toBe('offline/a_b_c_.mp3');
    expect(fs.writes[0]!.directory).toBe('DATA');
    expect(fs.writes[0]!.data).toBe(await blobToBase64(audioBlob([1, 2, 3])));
  });

  it('round-trips the audio bytes through get()', async () => {
    const { store } = nativeStore();
    await store.put('track-1', audioBlob([0, 1, 250, 255]));
    const blob = await store.get('track-1');
    expect(blob).not.toBeNull();
    expect(await blobBytes(blob!)).toEqual([0, 1, 250, 255]);
    // A file has no content type; the store labels stored audio as mpeg.
    expect(blob!.type).toBe('audio/mpeg');
  });

  it('returns null when the file is missing or unreadable', async () => {
    const { store } = nativeStore();
    expect(await store.get('never-written')).toBeNull();
  });

  it('delete() swallows missing-file errors', async () => {
    const { fs, store } = nativeStore();
    await expect(store.delete('absent')).resolves.toBeUndefined();
    await store.put('k', audioBlob([1]));
    await store.delete('k');
    expect(fs.files.size).toBe(0);
  });

  it('keys() lists stored file names, or [] when the directory cannot be read', async () => {
    const { fs, store } = nativeStore();
    expect(await store.keys()).toEqual([]);
    await store.put('alpha', audioBlob([1]));
    await store.put('beta', audioBlob([2]));
    expect((await store.keys()).sort()).toEqual(['alpha', 'beta']);

    fs.directoryReadError = new Error('permission denied');
    expect(await store.keys()).toEqual([]);
  });

  it('falls back to the platform Directory.Data when dataDirectory is empty', async () => {
    const fs = new FakeFilesystem();
    const store = new NativeFileStore(
      'offline',
      async () => ({ Filesystem: fs, Directory: { Data: 'DATA_FROM_PLUGIN' } }),
      '',
    );
    await store.put('k', audioBlob([1]));
    expect(fs.writes[0]!.directory).toBe('DATA_FROM_PLUGIN');
  });
});

describe('base64 helpers', () => {
  it('round-trips bytes, including across the chunk boundary', async () => {
    for (const length of [0, 1, 0x7fff, 0x8000, 0x8001, 0x10001]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = (i * 31 + 7) % 256;
      const blob = new Blob([bytes], { type: 'audio/ogg' });
      const restored = base64ToBlob(await blobToBase64(blob));
      expect(restored.size).toBe(length);
      expect(await blobBytes(restored)).toEqual([...bytes]);
    }
  });

  it('base64ToBlob defaults to audio/mpeg and honours an explicit type', () => {
    expect(base64ToBlob(btoa('abc')).type).toBe('audio/mpeg');
    expect(base64ToBlob(btoa('abc'), 'audio/flac').type).toBe('audio/flac');
    expect(base64ToBlob(btoa('abc')).size).toBe(3);
  });
});
