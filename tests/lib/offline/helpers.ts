/**
 * Shared helpers for the offline-cache test suites.
 *
 * Every database gets a unique name so tests never share IndexedDB state, and
 * every store here is a real implementation unless the test explicitly needs a
 * gate to make a race deterministic.
 */

import { Blob as NodeBlob } from 'node:buffer';
import { IndexedDbOfflineDatabase } from '$lib/offline/db';
import type { BlobStore } from '$lib/offline/blobStore';
import type { Track } from '$lib/domain/types';

/**
 * fake-indexeddb serialises values with Node's `structuredClone`, which does not
 * understand jsdom's `Blob`: it clones one to a bare `{}`, silently dropping the
 * audio bytes. Node's own Blob does survive `structuredClone`, so use it for the
 * cache tests. This mirrors how a real browser persists Blobs natively, which is
 * exactly the behaviour these tests need to exercise.
 */
globalThis.Blob = NodeBlob as unknown as typeof Blob;

let dbSeq = 0;
const opened: IndexedDbOfflineDatabase[] = [];

/** A fresh, uniquely-named IndexedDB database (fake-indexeddb backed). */
export function freshDb(): IndexedDbOfflineDatabase {
  dbSeq += 1;
  const db = new IndexedDbOfflineDatabase({
    name: `stave-test-${dbSeq}-${Math.random().toString(36).slice(2)}`,
  });
  opened.push(db);
  return db;
}

/** Close every database a test opened. Call from `afterEach`. */
export function closeOpenedDbs(): void {
  for (const db of opened.splice(0)) db.close();
}

/** A Blob from raw bytes; content is what matters for round-trip assertions. */
export function audioBlob(bytes: number[], type = 'audio/mpeg'): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

export async function blobBytes(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())];
}

/** Await a promise that settles only when `cond` becomes true. */
export async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Like `waitFor`, for predicates that must themselves await. */
export async function waitUntil(cond: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Wraps a real BlobStore and lets a test hold `put` open. Needed to park a
 * download *between* writing the blob and writing its metadata, which is the
 * exact window where a cancellation used to be able to leave a partial entry.
 */
export class GatedBlobStore implements BlobStore {
  private block: Promise<void> | null = null;
  private unblock: (() => void) | null = null;
  private waiting = 0;
  private finished = 0;

  constructor(private readonly inner: BlobStore) {}

  /** Put calls currently parked on the gate. */
  get pendingPuts(): number {
    return this.waiting;
  }

  /** Put calls that have completed through the gate. */
  get completedPuts(): number {
    return this.finished;
  }

  /** Hold all subsequent `put` calls until the returned release fn runs. */
  blockPuts(): () => void {
    if (!this.block) {
      this.block = new Promise<void>((resolve) => {
        this.unblock = resolve;
      });
    }
    return () => {
      this.unblock?.();
      this.block = null;
      this.unblock = null;
    };
  }

  async put(key: string, blob: Blob): Promise<void> {
    const gate = this.block;
    if (gate) {
      this.waiting += 1;
      await gate;
      this.waiting -= 1;
    }
    await this.inner.put(key, blob);
    this.finished += 1;
  }

  get(key: string): Promise<Blob | null> {
    return this.inner.get(key);
  }

  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }

  keys(): Promise<string[]> {
    return this.inner.keys();
  }
}

export interface PendingFetch {
  track: Track;
  resolve: (blob: Blob) => void;
  reject: (reason?: unknown) => void;
}

/**
 * A `fetchAudio` whose transfers stay open until the test resolves them,
 * so concurrency and cancellation are observable rather than racy.
 */
export function controllableFetch(blobFactory?: (track: Track) => Blob) {
  const pending: PendingFetch[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;

  const fetchAudio = (track: Track): Promise<Blob> => {
    calls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise<Blob>((resolve, reject) => {
      pending.push({
        track,
        resolve: (blob) => {
          inFlight -= 1;
          resolve(blob);
        },
        reject: (reason) => {
          inFlight -= 1;
          reject(reason);
        },
      });
    });
  };

  const settle = (index: number, blob?: Blob): void => {
    const [item] = pending.splice(index, 1);
    if (!item) throw new Error(`no pending fetch at ${index}`);
    item.resolve(blob ?? blobFactory?.(item.track) ?? audioBlob([1, 2, 3]));
  };

  return {
    fetchAudio,
    pending,
    settle,
    resolveNext: (blob?: Blob) => settle(0, blob),
    get inFlight() {
      return inFlight;
    },
    get maxInFlight() {
      return maxInFlight;
    },
    get calls() {
      return calls;
    },
  };
}
