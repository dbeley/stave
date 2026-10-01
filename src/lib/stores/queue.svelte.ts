/**
 * The play queue.
 *
 * Pure list manipulation plus a cursor: no audio, no network, no DOM. That
 * makes the fiddly parts (reordering, repeat modes, shuffle/unshuffle) cheap to
 * test — see tests/lib/stores/queue.test.ts.
 *
 * Playback order *is* `items` order. Shuffling therefore reorders the tail of
 * the queue and remembers the pristine order so it can be undone.
 */

import type { Track } from '$lib/domain/types';
import { uniqueId } from '$lib/utils/dom';
import { loadPersisted, savePersisted, type StorageLike, defaultStorage } from '$lib/utils/persist';

export type RepeatMode = 'off' | 'all' | 'one';

export const REPEAT_CYCLE: readonly RepeatMode[] = ['off', 'all', 'one'];

export interface QueueItem {
  /** Stable identity independent of the track: the same track can be queued twice. */
  uid: string;
  track: Track;
}

export interface QueueState {
  items: QueueItem[];
  /** Index of the playing item, -1 when the queue is empty. */
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Cursor used by the queue panel for reorder/remove. */
  cursor: number;
}

export interface QueueSnapshot extends QueueState {
  pristine?: string[];
}

export const QUEUE_KEY = 'stave:queue';

/** The outcome of asking the queue what to play next. */
export type NextResult =
  { kind: 'index'; index: number } | { kind: 'repeat-one'; index: number } | { kind: 'end' };

export interface QueueOptions {
  storage?: StorageLike | null;
  random?: () => number;
  /** Skip persistence (tests). */
  persist?: boolean;
}

export class QueueStore {
  readonly state: QueueState;

  private pristine: QueueItem[] | null = null;
  private readonly random: () => number;
  private readonly storage: StorageLike | null;
  private readonly persistEnabled: boolean;

  constructor(options: QueueOptions = {}) {
    this.random = options.random ?? Math.random;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.persistEnabled = options.persist ?? true;
    this.state = $state<QueueState>(this.load());
  }

  // ---------------------------------------------------------------- reads

  get items(): QueueItem[] {
    return this.state.items;
  }

  get length(): number {
    return this.state.items.length;
  }

  get isEmpty(): boolean {
    return this.state.items.length === 0;
  }

  get current(): QueueItem | undefined {
    return this.state.items[this.state.index];
  }

  get currentTrack(): Track | undefined {
    return this.current?.track;
  }

  /** Items strictly after the playing one. */
  get upcoming(): QueueItem[] {
    if (this.state.index < 0) return this.state.items;
    return this.state.items.slice(this.state.index + 1);
  }

  get tracks(): Track[] {
    return this.state.items.map((item) => item.track);
  }

  get repeat(): RepeatMode {
    return this.state.repeat;
  }

  get shuffle(): boolean {
    return this.state.shuffle;
  }

  indexOfUid(uid: string): number {
    return this.state.items.findIndex((item) => item.uid === uid);
  }

  // ------------------------------------------------------------- writes

  /** Replace the queue. `startIndex` is clamped into range. */
  set(tracks: Track[], startIndex = 0): void {
    const items = tracks.map(toQueueItem);
    this.state.items = items;
    this.state.index = items.length === 0 ? -1 : clampIndex(startIndex, items.length);
    this.state.cursor = Math.max(0, this.state.index);
    this.pristine = null;
    if (this.state.shuffle) this.shuffleTail();
    this.persist();
  }

  /** Append to the very end. Returns the index of the first inserted item. */
  append(tracks: Track[]): number {
    if (tracks.length === 0) return -1;
    const first = this.state.items.length;
    this.state.items = [...this.state.items, ...tracks.map(toQueueItem)];
    if (this.state.index < 0) this.state.index = 0;
    this.persist();
    return first;
  }

  /** Insert directly after the playing item ("play next"). */
  insertAfterCurrent(tracks: Track[]): number {
    if (tracks.length === 0) return -1;
    const at = this.state.index < 0 ? this.state.items.length : this.state.index + 1;
    return this.insertAt(at, tracks);
  }

  insertAt(index: number, tracks: Track[]): number {
    if (tracks.length === 0) return -1;
    const at = Math.min(Math.max(index, 0), this.state.items.length);
    const items = [...this.state.items];
    items.splice(at, 0, ...tracks.map(toQueueItem));
    this.state.items = items;
    if (this.state.index < 0) this.state.index = 0;
    else if (at <= this.state.index) this.state.index += tracks.length;
    this.persist();
    return at;
  }

  /** Remove by item uid. Keeps playing the same item when possible. */
  remove(uids: string[]): number {
    const doomed = new Set(uids);
    if (doomed.size === 0) return 0;
    const playingUid = this.current?.uid;
    const items = this.state.items.filter((item) => !doomed.has(item.uid));
    const removed = this.state.items.length - items.length;
    this.state.items = items;

    if (items.length === 0) {
      this.state.index = -1;
      this.state.cursor = 0;
    } else {
      const playingIndex = playingUid ? items.findIndex((item) => item.uid === playingUid) : -1;
      this.state.index =
        playingIndex >= 0 ? playingIndex : clampIndex(this.state.index, items.length);
      this.state.cursor = clampIndex(this.state.cursor, items.length);
    }
    this.persist();
    return removed;
  }

  removeAt(indices: number[]): number {
    const uids = indices
      .map((index) => this.state.items[index]?.uid)
      .filter((uid): uid is string => Boolean(uid));
    return this.remove(uids);
  }

  removeAtCursor(): number {
    if (this.isEmpty) return 0;
    const removed = this.removeAt([this.state.cursor]);
    this.state.cursor = clampIndex(this.state.cursor, Math.max(1, this.length));
    this.persist();
    return removed;
  }

  /** Move one item; both indices are clamped. */
  move(from: number, to: number): void {
    const length = this.state.items.length;
    if (length === 0) return;
    const source = clampIndex(from, length);
    const target = clampIndex(to, length);
    if (source === target) return;

    const items = [...this.state.items];
    const [moved] = items.splice(source, 1);
    if (!moved) return;
    items.splice(target, 0, moved);
    this.state.items = items;

    // Keep the cursor and the playing item pointing at the same entries.
    if (this.state.index === source) this.state.index = target;
    else if (source < this.state.index && target >= this.state.index) this.state.index -= 1;
    else if (source > this.state.index && target <= this.state.index) this.state.index += 1;

    if (this.state.cursor === source) this.state.cursor = target;
    this.pristine = null;
    this.persist();
  }

  /** Move the item under the cursor up/down — the `J`/`K` shortcuts. */
  moveCursorItem(delta: number): boolean {
    const from = this.state.cursor;
    const to = from + delta;
    if (to < 0 || to >= this.length) return false;
    this.move(from, to);
    this.state.cursor = to;
    this.persist();
    return true;
  }

  moveCursor(delta: number): void {
    if (this.isEmpty) return;
    this.state.cursor = clampIndex(this.state.cursor + delta, this.length);
  }

  setCursor(index: number): void {
    this.state.cursor = this.isEmpty ? 0 : clampIndex(index, this.length);
  }

  clear(): void {
    this.state.items = [];
    this.state.index = -1;
    this.state.cursor = 0;
    this.pristine = null;
    this.persist();
  }

  /** Jump to a specific index (used by "play this now"). */
  jumpTo(index: number): number {
    if (this.isEmpty) return -1;
    this.state.index = clampIndex(index, this.length);
    this.state.cursor = this.state.index;
    this.persist();
    return this.state.index;
  }

  jumpToUid(uid: string): number {
    const index = this.indexOfUid(uid);
    return index < 0 ? -1 : this.jumpTo(index);
  }

  // -------------------------------------------------------------- order

  /**
   * What to play after the current item finishes.
   * - `repeat-one` asks the player to loop the same track,
   * - `end` means the queue ran out (the auto-DJ gets a chance here).
   */
  next(): NextResult {
    if (this.isEmpty) return { kind: 'end' };
    if (this.state.repeat === 'one') return { kind: 'repeat-one', index: this.state.index };

    const nextIndex = this.state.index + 1;
    if (nextIndex < this.length) return { kind: 'index', index: nextIndex };
    if (this.state.repeat === 'all') return { kind: 'index', index: 0 };
    return { kind: 'end' };
  }

  /** Previous item; wraps only when repeating everything. */
  previous(): number {
    if (this.isEmpty) return -1;
    const previousIndex = this.state.index - 1;
    if (previousIndex >= 0) return previousIndex;
    return this.state.repeat === 'all' ? this.length - 1 : 0;
  }

  setRepeat(mode: RepeatMode): void {
    this.state.repeat = mode;
    this.persist();
  }

  cycleRepeat(direction = 1): RepeatMode {
    const index = REPEAT_CYCLE.indexOf(this.state.repeat);
    const next = REPEAT_CYCLE[(index + direction + REPEAT_CYCLE.length) % REPEAT_CYCLE.length]!;
    this.setRepeat(next);
    return next;
  }

  /**
   * Toggle shuffle. Turning it on shuffles everything *after* the current item
   * (so the track you are listening to keeps playing) and remembers the earlier
   * order; turning it off restores that order.
   */
  setShuffle(enabled: boolean): void {
    if (enabled === this.state.shuffle) return;
    this.state.shuffle = enabled;
    if (enabled) {
      this.pristine = [...this.state.items];
      this.shuffleTail();
    } else if (this.pristine) {
      const playingUid = this.current?.uid;
      this.state.items = this.pristine;
      if (playingUid) {
        const index = this.indexOfUid(playingUid);
        if (index >= 0) this.state.index = index;
      }
      this.pristine = null;
    }
    this.state.cursor = clampIndex(this.state.cursor, Math.max(1, this.length));
    this.persist();
  }

  toggleShuffle(): boolean {
    this.setShuffle(!this.state.shuffle);
    return this.state.shuffle;
  }

  /** Insert at the front of the upcoming items (auto-DJ uses this). */
  private shuffleTail(): void {
    const head = this.state.items.slice(0, Math.max(0, this.state.index + 1));
    const tail = this.state.items.slice(Math.max(0, this.state.index + 1));
    this.state.items = [...head, ...shuffle(tail, this.random)];
  }

  // ----------------------------------------------------------- persistence

  snapshot(): QueueSnapshot {
    return {
      items: this.state.items.map((item) => ({ uid: item.uid, track: { ...item.track } })),
      index: this.state.index,
      shuffle: this.state.shuffle,
      repeat: this.state.repeat,
      cursor: this.state.cursor,
    };
  }

  restore(snapshot: QueueSnapshot | null | undefined): void {
    if (!snapshot || !Array.isArray(snapshot.items)) return;
    const items = snapshot.items.filter(isQueueItem).map((item) => ({
      uid: item.uid || uniqueId('q'),
      track: item.track,
    }));
    this.state.items = items;
    this.state.index = items.length === 0 ? -1 : clampIndex(snapshot.index ?? 0, items.length);
    this.state.shuffle = snapshot.shuffle ?? false;
    this.state.repeat = snapshot.repeat ?? 'off';
    this.state.cursor =
      items.length === 0 ? 0 : clampIndex(snapshot.cursor ?? this.state.index, items.length);
    this.pristine = null;
  }

  private load(): QueueState {
    const empty: QueueState = { items: [], index: -1, shuffle: false, repeat: 'off', cursor: 0 };
    if (!this.persistEnabled) return empty;
    const stored = loadPersisted<QueueState>(QUEUE_KEY, empty, { storage: this.storage });
    const items = Array.isArray(stored.items) ? stored.items.filter(isQueueItem) : [];
    return {
      items,
      index: items.length === 0 ? -1 : clampIndex(stored.index ?? 0, items.length),
      shuffle: Boolean(stored.shuffle),
      repeat: stored.repeat === 'all' || stored.repeat === 'one' ? stored.repeat : 'off',
      cursor: items.length === 0 ? 0 : clampIndex(stored.cursor ?? 0, items.length),
    };
  }

  private persist(): void {
    if (!this.persistEnabled) return;
    // Repeat 'one' is a transient preference; persisting it surprises people on
    // a cold start, so it is stored as 'off'.
    savePersisted<QueueSnapshot>(
      QUEUE_KEY,
      { ...this.snapshot(), repeat: this.state.repeat === 'one' ? 'off' : this.state.repeat },
      { storage: this.storage },
    );
  }
}

export function toQueueItem(track: Track): QueueItem {
  return { uid: uniqueId('q'), track };
}

function isQueueItem(value: unknown): value is QueueItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<QueueItem>;
  return typeof item.uid === 'string' && Boolean(item.track) && typeof item.track?.id === 'string';
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), length - 1);
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = copy[i]!;
    const b = copy[j]!;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}
