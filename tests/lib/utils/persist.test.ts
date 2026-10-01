import { describe, it, expect, vi } from 'vitest';
import {
  PERSIST_VERSION,
  clone,
  defaultStorage,
  loadPersisted,
  plain,
  removePersisted,
  savePersisted,
  sessionStorageSafe,
} from '$lib/utils/persist';
import type { StorageLike } from '$lib/utils/persist';

/** In-memory StorageLike for deterministic tests. */
function memStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    raw: map,
  };
}

describe('loadPersisted', () => {
  it('round-trips a value written by savePersisted', () => {
    const storage = memStorage();
    savePersisted('k', { a: 1, list: [1, 2, 3] }, { storage });
    expect(loadPersisted('k', { a: 0, list: [] }, { storage })).toEqual({ a: 1, list: [1, 2, 3] });
  });

  it('returns a clone of the defaults when nothing is stored', () => {
    const storage = memStorage();
    const defaults = { a: 1, nested: { b: 2 } };
    const loaded = loadPersisted('missing', defaults, { storage });
    expect(loaded).toEqual(defaults);
    expect(loaded).not.toBe(defaults);
    expect(loaded.nested).not.toBe(defaults.nested);
  });

  it('merges stored data onto defaults so new fields get sane values', () => {
    const storage = memStorage();
    // Stored before a `newField` was added to the schema.
    storage.raw.set('k', JSON.stringify({ v: PERSIST_VERSION, data: { a: 5 } }));
    expect(loadPersisted('k', { a: 0, newField: 'default' }, { storage })).toEqual({
      a: 5,
      newField: 'default',
    });
  });

  it('falls back to defaults on corrupt JSON', () => {
    const storage = memStorage({ k: 'this is not json {' });
    expect(loadPersisted('k', { a: 1 }, { storage })).toEqual({ a: 1 });
  });

  it('falls back to defaults on a version mismatch without a migrator', () => {
    const storage = memStorage();
    storage.raw.set('k', JSON.stringify({ v: 99, data: { a: 5 } }));
    expect(loadPersisted('k', { a: 0 }, { storage })).toEqual({ a: 0 });
  });

  it('calls migrate() with the stored data and version on a mismatch', () => {
    const storage = memStorage();
    storage.raw.set('k', JSON.stringify({ v: 99, data: { a: 5 } }));
    const migrate = vi.fn(() => ({ a: 42 }));
    expect(loadPersisted('k', { a: 0 }, { storage, migrate })).toEqual({ a: 42 });
    expect(migrate).toHaveBeenCalledWith({ a: 5 }, 99);
  });

  it('hands legacy/plain shapes to migrate() with version 0', () => {
    const storage = memStorage({ k: JSON.stringify({ a: 9 }) });
    const migrate = vi.fn((data: unknown) => ({ a: (data as { a: number }).a * 2 }));
    expect(loadPersisted('k', { a: 0 }, { storage, migrate })).toEqual({ a: 18 });
    expect(migrate).toHaveBeenCalledWith({ a: 9 }, 0);
  });

  it('ignores a migrator that returns undefined', () => {
    const storage = memStorage({ k: JSON.stringify({ a: 9 }) });
    expect(loadPersisted('k', { a: 0 }, { storage, migrate: () => undefined })).toEqual({ a: 0 });
  });

  it('returns defaults when storage is null (exotic contexts)', () => {
    expect(loadPersisted('k', { a: 1 }, { storage: null })).toEqual({ a: 1 });
  });

  it('returns defaults when reading throws', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(loadPersisted('k', { a: 1 }, { storage })).toEqual({ a: 1 });
  });

  it('does not merge arrays or primitives — it clones the defaults', () => {
    const storage = memStorage();
    storage.raw.set('k', JSON.stringify({ v: PERSIST_VERSION, data: [1, 2, 3] }));
    expect(loadPersisted('k', [9], { storage })).toEqual([9]);
  });
});

describe('savePersisted', () => {
  it('writes the versioned envelope', () => {
    const storage = memStorage();
    savePersisted('k', { a: 1 }, { storage });
    expect(JSON.parse(storage.raw.get('k')!)).toEqual({ v: PERSIST_VERSION, data: { a: 1 } });
  });

  it('honours a custom version', () => {
    const storage = memStorage();
    savePersisted('k', { a: 1 }, { storage, version: 7 });
    expect(JSON.parse(storage.raw.get('k')!)).toEqual({ v: 7, data: { a: 1 } });
  });

  it('strips proxies before serialising', () => {
    const storage = memStorage();
    const proxy = new Proxy({ a: 1, n: { b: 2 } }, {});
    savePersisted('k', proxy, { storage });
    expect(JSON.parse(storage.raw.get('k')!).data).toEqual({ a: 1, n: { b: 2 } });
  });

  it('is a no-op when storage is null or writes throw', () => {
    expect(() => savePersisted('k', { a: 1 }, { storage: null })).not.toThrow();
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(() => savePersisted('k', { a: 1 }, { storage })).not.toThrow();
  });
});

describe('removePersisted', () => {
  it('removes a key', () => {
    const storage = memStorage({ k: 'v' });
    removePersisted('k', storage);
    expect(storage.getItem('k')).toBeNull();
  });

  it('is a no-op with null storage or when removal throws', () => {
    expect(() => removePersisted('k', null)).not.toThrow();
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('nope');
      },
    };
    expect(() => removePersisted('k', storage)).not.toThrow();
  });
});

describe('plain / clone', () => {
  it('returns primitives unchanged', () => {
    expect(plain(42)).toBe(42);
    expect(plain('x')).toBe('x');
    expect(plain(null)).toBeNull();
    expect(plain(undefined)).toBeUndefined();
  });

  it('deep-copies a nested object', () => {
    const source = { a: 1, nested: { list: [1, 2] } };
    const out = plain(source);
    expect(out).toEqual(source);
    expect(out).not.toBe(source);
    expect(out.nested).not.toBe(source.nested);
  });

  it('strips a Svelte-style proxy into a plain object', () => {
    const target = { count: 3, nested: { list: [1, 2] } };
    const proxy = new Proxy(target, {
      get: (t, prop, receiver) => Reflect.get(t, prop, receiver),
      set: () => {
        throw new Error('proxies may reject writes');
      },
    });

    const out = plain(proxy);
    expect(out).toEqual(target);
    expect(out).not.toBe(target);
    expect(out).not.toBe(proxy);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(out.nested)).toBe(Object.prototype);
  });

  it('clone() delegates to plain()', () => {
    const source = { a: { b: 1 } };
    expect(clone(source)).toEqual(source);
    expect(clone(source)).not.toBe(source);
  });
});

describe('storage detection', () => {
  it('finds localStorage in jsdom', () => {
    const storage = defaultStorage();
    expect(storage).not.toBeNull();
    expect(typeof storage?.getItem).toBe('function');
  });

  it('finds sessionStorage in jsdom', () => {
    expect(sessionStorageSafe()).not.toBeNull();
  });
});
