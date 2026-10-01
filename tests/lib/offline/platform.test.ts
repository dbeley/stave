import { describe, it, expect, afterEach } from 'vitest';
import {
  createBlobStore,
  isNativePlatform,
  platformLabel,
  type CapacitorLike,
} from '$lib/offline/platform';
import { IdbBlobStore, NativeFileStore, type BlobStore } from '$lib/offline/blobStore';
import type { OfflineDatabase } from '$lib/offline/db';
import { closeOpenedDbs, freshDb } from './helpers';

const globalWithCapacitor = globalThis as { Capacitor?: CapacitorLike };

function setGlobalCapacitor(value: CapacitorLike | undefined): void {
  if (value === undefined) delete globalWithCapacitor.Capacitor;
  else globalWithCapacitor.Capacitor = value;
}

afterEach(() => {
  setGlobalCapacitor(undefined);
  closeOpenedDbs();
});

describe('isNativePlatform', () => {
  it('is false when Capacitor is absent', () => {
    expect(isNativePlatform()).toBe(false);
    expect(isNativePlatform(null)).toBe(false);
  });

  it('prefers Capacitor.isNativePlatform() when present', () => {
    expect(isNativePlatform({ isNativePlatform: () => true })).toBe(true);
    expect(isNativePlatform({ isNativePlatform: () => false })).toBe(false);
  });

  it('treats a throwing isNativePlatform() as web (offline store, not files)', () => {
    expect(
      isNativePlatform({
        isNativePlatform: () => {
          throw new Error('bridge not ready');
        },
      }),
    ).toBe(false);
  });

  it('falls back to getPlatform(), treating "web" and empty as not native', () => {
    expect(isNativePlatform({ getPlatform: () => 'android' })).toBe(true);
    expect(isNativePlatform({ getPlatform: () => 'ios' })).toBe(true);
    expect(isNativePlatform({ getPlatform: () => 'web' })).toBe(false);
    expect(isNativePlatform({ getPlatform: () => '' })).toBe(false);
  });

  it('is false for a Capacitor object with neither method', () => {
    expect(isNativePlatform({})).toBe(false);
  });

  it('reads the global window.Capacitor when no argument is given', () => {
    setGlobalCapacitor({ getPlatform: () => 'ios' });
    expect(isNativePlatform()).toBe(true);
    setGlobalCapacitor({ getPlatform: () => 'web' });
    expect(isNativePlatform()).toBe(false);
  });

  it('lets an explicit argument override the global', () => {
    setGlobalCapacitor({ isNativePlatform: () => true });
    expect(isNativePlatform({ isNativePlatform: () => false })).toBe(false);
  });
});

describe('createBlobStore', () => {
  function db(): OfflineDatabase {
    return freshDb();
  }

  it('returns the IndexedDB store by default on the web', () => {
    expect(createBlobStore(db())).toBeInstanceOf(IdbBlobStore);
    expect(createBlobStore(db(), { native: false })).toBeInstanceOf(IdbBlobStore);
  });

  it('returns the native file store when explicitly requested', () => {
    expect(createBlobStore(db(), { native: true })).toBeInstanceOf(NativeFileStore);
  });

  it('detects a native platform from the global Capacitor', () => {
    setGlobalCapacitor({ getPlatform: () => 'android' });
    expect(createBlobStore(db())).toBeInstanceOf(NativeFileStore);
    // An explicit { native: false } still wins over detection.
    expect(createBlobStore(db(), { native: false })).toBeInstanceOf(IdbBlobStore);
  });

  it('produces a working store on the web path', async () => {
    const store: BlobStore = createBlobStore(db());
    await store.put('t1', new Blob([new Uint8Array([5])]));
    expect((await store.get('t1'))?.size).toBe(1);
  });
});

describe('platformLabel', () => {
  it('is "web" with no Capacitor', () => {
    expect(platformLabel()).toBe('web');
  });

  it('reports the native platform name', () => {
    setGlobalCapacitor({ getPlatform: () => 'android' });
    expect(platformLabel()).toBe('android');
    setGlobalCapacitor({ getPlatform: () => 'ios' });
    expect(platformLabel()).toBe('ios');
  });

  it('is "web" when Capacitor reports web, is empty, or throws', () => {
    setGlobalCapacitor({ getPlatform: () => 'web' });
    expect(platformLabel()).toBe('web');
    setGlobalCapacitor({ getPlatform: () => '' });
    expect(platformLabel()).toBe('web');
    setGlobalCapacitor({
      getPlatform: () => {
        throw new Error('no bridge');
      },
    });
    expect(platformLabel()).toBe('web');
    setGlobalCapacitor({});
    expect(platformLabel()).toBe('web');
  });
});
