/**
 * "Listen later" — a local, album-only list.
 *
 * It is deliberately *not* sent to the server (no star, no playlist): its whole
 * purpose is to mark albums whose audio should be pulled into the offline
 * cache. When the offline cache is disabled the list still works as a private
 * shortlist.
 */

import type { Album } from '$lib/domain/types';
import { loadPersisted, savePersisted, type StorageLike, defaultStorage } from '$lib/utils/persist';

export interface ListenLaterEntry {
  album: Album;
  addedAt: number;
}

export interface ListenLaterDeps {
  /** Called after any change, so the offline cache can react. */
  sync?: (entries: ListenLaterEntry[], changes: { added: Album[]; removed: string[] }) => void;
  now?: () => number;
}

export const LISTEN_LATER_KEY = 'stave:listen-later';

export class ListenLaterStore {
  readonly state: { entries: ListenLaterEntry[] };

  private readonly storage: StorageLike | null;
  private readonly deps: ListenLaterDeps;

  constructor(deps: ListenLaterDeps = {}, storage?: StorageLike | null) {
    this.deps = deps;
    this.storage = storage === undefined ? defaultStorage() : storage;
    const stored = loadPersisted<{ entries: ListenLaterEntry[] }>(
      LISTEN_LATER_KEY,
      { entries: [] },
      { storage: this.storage },
    );
    this.state = $state<{ entries: ListenLaterEntry[] }>({
      entries: Array.isArray(stored.entries) ? stored.entries.filter(isEntry) : [],
    });
  }

  get albums(): Album[] {
    return this.state.entries.map((entry) => entry.album);
  }

  get count(): number {
    return this.state.entries.length;
  }

  get isEmpty(): boolean {
    return this.state.entries.length === 0;
  }

  has(albumId: string): boolean {
    return this.state.entries.some((entry) => entry.album.id === albumId);
  }

  add(album: Album): void {
    if (this.has(album.id)) return;
    const entry: ListenLaterEntry = { album, addedAt: this.now() };
    this.state.entries = [entry, ...this.state.entries];
    this.commit({ added: [album], removed: [] });
  }

  /** Add or remove, returning the resulting membership. */
  toggle(album: Album): boolean {
    if (this.has(album.id)) {
      this.remove(album.id);
      return false;
    }
    this.add(album);
    return true;
  }

  remove(albumId: string): void {
    const entry = this.state.entries.find((candidate) => candidate.album.id === albumId);
    if (!entry) return;
    this.state.entries = this.state.entries.filter((candidate) => candidate.album.id !== albumId);
    this.commit({ added: [], removed: [albumId] });
  }

  /** Reorder — the list doubles as a "what to grab next" queue. */
  move(from: number, to: number): void {
    const length = this.state.entries.length;
    if (length === 0) return;
    const source = Math.min(Math.max(from, 0), length - 1);
    const target = Math.min(Math.max(to, 0), length - 1);
    if (source === target) return;
    const entries = [...this.state.entries];
    const [moved] = entries.splice(source, 1);
    if (!moved) return;
    entries.splice(target, 0, moved);
    this.state.entries = entries;
    this.commit({ added: [], removed: [] });
  }

  clear(): void {
    const removed = this.state.entries.map((entry) => entry.album.id);
    this.state.entries = [];
    this.commit({ added: [], removed });
  }

  /** Refresh album metadata carried in the list (e.g. after a rescan). */
  updateAlbum(album: Album): void {
    this.state.entries = this.state.entries.map((entry) =>
      entry.album.id === album.id ? { album, addedAt: entry.addedAt } : entry,
    );
    this.commit({ added: [], removed: [] });
  }

  entriesForOffline(): Album[] {
    return this.albums;
  }

  private commit(changes: { added: Album[]; removed: string[] }): void {
    savePersisted(LISTEN_LATER_KEY, { entries: this.state.entries }, { storage: this.storage });
    this.deps.sync?.(this.state.entries, changes);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

function isEntry(value: unknown): value is ListenLaterEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ListenLaterEntry>;
  return Boolean(entry.album) && typeof entry.album?.id === 'string';
}
