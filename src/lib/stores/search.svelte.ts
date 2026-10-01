/**
 * Search.
 *
 * Typing in a TUI is interactive, so queries are debounced and every new query
 * supersedes the previous one — a slow response for "a" must never overwrite
 * the results for "abbey road".
 */

import type { SubsonicClient } from '$lib/api/client';
import { describeError } from '$lib/api/errors';
import { emptySearchResults, type SearchResults } from '$lib/domain/types';

export interface SearchState {
  query: string;
  /** The query the current results belong to. */
  resultsFor: string;
  results: SearchResults;
  loading: boolean;
  error: string | undefined;
  /** Total result count, for the status line. */
  total: number;
}

export interface SearchDeps {
  client: () => SubsonicClient | null;
  onError?: (message: string) => void;
  debounceMs?: number;
  /** Injectable scheduler so tests do not need real timers. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancelSchedule?: (handle: unknown) => void;
  counts?: { artists: number; albums: number; tracks: number };
}

export const DEFAULT_DEBOUNCE_MS = 220;
/** Below this length a query matches half the library and is not worth sending. */
export const MIN_QUERY_LENGTH = 1;

export class SearchStore {
  readonly state: SearchState;

  private readonly deps: SearchDeps;
  private timer: unknown = null;
  /** Increments per request; only the newest response is applied. */
  private epoch = 0;

  constructor(deps: SearchDeps) {
    this.deps = deps;
    this.state = $state<SearchState>({
      query: '',
      resultsFor: '',
      results: emptySearchResults(),
      loading: false,
      error: undefined,
      total: 0,
    });
  }

  get hasQuery(): boolean {
    return this.state.query.trim().length >= MIN_QUERY_LENGTH;
  }

  get hasResults(): boolean {
    return this.state.total > 0;
  }

  get isEmptyResult(): boolean {
    return this.hasQuery && !this.state.loading && this.state.total === 0 && !this.state.error;
  }

  /** Update the query and (debounced) run the search. */
  setQuery(query: string): void {
    this.state.query = query;
    this.scheduleSearch();
  }

  /** Run immediately (Enter, or a keystroke in a TUI-style input). */
  async submit(query = this.state.query): Promise<void> {
    this.cancelTimer();
    this.state.query = query;
    await this.run(query);
  }

  private scheduleSearch(): void {
    this.cancelTimer();
    const schedule = this.deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    const trimmed = this.state.query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      this.state.results = emptySearchResults();
      this.state.resultsFor = '';
      this.state.total = 0;
      this.state.loading = false;
      this.state.error = undefined;
      return;
    }
    this.state.loading = true;
    this.timer = schedule(() => {
      this.timer = null;
      void this.run(trimmed);
    }, this.deps.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  private async run(query: string): Promise<void> {
    const client = this.deps.client();
    const epoch = ++this.epoch;

    if (!client || query.trim().length < MIN_QUERY_LENGTH) {
      this.state.loading = false;
      this.state.results = emptySearchResults();
      this.state.total = 0;
      return;
    }

    this.state.loading = true;
    this.state.error = undefined;

    try {
      const counts = this.deps.counts ?? { artists: 20, albums: 30, tracks: 50 };
      const results = await client.search3(query, {
        artistCount: counts.artists,
        albumCount: counts.albums,
        songCount: counts.tracks,
      });
      // A newer query started while this one was in flight: discard.
      if (epoch !== this.epoch) return;
      this.state.results = results;
      this.state.resultsFor = query;
      this.state.total = results.artists.length + results.albums.length + results.tracks.length;
      this.state.loading = false;
    } catch (error) {
      if (epoch !== this.epoch) return;
      const message = describeError(error);
      this.state.loading = false;
      this.state.error = message;
      this.deps.onError?.(message);
    }
  }

  clear(): void {
    this.cancelTimer();
    this.epoch += 1;
    this.state.query = '';
    this.state.resultsFor = '';
    this.state.results = emptySearchResults();
    this.state.loading = false;
    this.state.error = undefined;
    this.state.total = 0;
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    const cancel =
      this.deps.cancelSchedule ?? ((handle: unknown) => clearTimeout(handle as number));
    cancel(this.timer);
    this.timer = null;
  }
}
