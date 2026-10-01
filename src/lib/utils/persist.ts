/**
 * localStorage helpers.
 *
 * Every persisted value is wrapped in a `{ v, data }` envelope so the schema can
 * evolve: readers can detect an older version, try a migration, and fall back to
 * defaults instead of crashing on a stale shape.
 */

export const PERSIST_VERSION = 1;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface Envelope<T> {
  v: number;
  data: T;
}

/** localStorage when available (jsdom, browsers) — null in exotic contexts. */
export function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function sessionStorageSafe(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function loadPersisted<T>(
  key: string,
  defaults: T,
  options: {
    storage?: StorageLike | null;
    version?: number;
    migrate?: (data: unknown, version: number) => T | undefined;
  } = {},
): T {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const version = options.version ?? PERSIST_VERSION;
  if (!storage) return clone(defaults);

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return clone(defaults);
  }
  if (!raw) return clone(defaults);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return clone(defaults);
  }

  if (parsed && typeof parsed === 'object' && 'data' in (parsed as Envelope<unknown>)) {
    const envelope = parsed as Envelope<unknown>;
    if (envelope.v === version) return mergeDefaults(defaults, envelope.data);
    const migrated = options.migrate?.(envelope.data, envelope.v);
    if (migrated !== undefined) return migrated;
    return clone(defaults);
  }

  // Legacy/plain shapes are handed to the migrator (or dropped).
  const migrated = options.migrate?.(parsed, 0);
  return migrated ?? clone(defaults);
}

export function savePersisted<T>(
  key: string,
  data: T,
  options: { storage?: StorageLike | null; version?: number } = {},
): void {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (!storage) return;
  const envelope: Envelope<T> = { v: options.version ?? PERSIST_VERSION, data: plain(data) };
  try {
    storage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Quota exceeded / private mode: persistence is best-effort by design.
  }
}

export function removePersisted(key: string, storage?: StorageLike | null): void {
  const target = storage === undefined ? defaultStorage() : storage;
  try {
    target?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Deep copy through JSON. Also strips Svelte 5 `$state` proxies — those throw
 * `DataCloneError` when written to IndexedDB and serialise oddly elsewhere.
 */
export function plain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

/** Deep clone that preserves nothing exotic — used for defaults. */
export function clone<T>(value: T): T {
  return plain(value);
}

/** Shallow-merge stored data onto defaults so new fields get sane values. */
function mergeDefaults<T>(defaults: T, stored: unknown): T {
  if (
    defaults !== null &&
    typeof defaults === 'object' &&
    !Array.isArray(defaults) &&
    stored !== null &&
    typeof stored === 'object' &&
    !Array.isArray(stored)
  ) {
    return { ...(defaults as object), ...(stored as object) } as T;
  }
  return clone(defaults);
}
