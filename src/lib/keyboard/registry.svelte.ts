/**
 * The binding registry.
 *
 * One declarative table drives three things at once: behaviour, the help
 * overlay and the hint bar. That is the whole point — a shortcut cannot exist
 * without being documented, because they are the same record.
 *
 * Scope precedence decides who wins when two bindings share a chord: the first
 * scope present in `activeScopes()` takes it. Overlays therefore shadow page
 * shortcuts, and page shortcuts shadow globals.
 */

import { chordOf, isSequencePrefix, parseSequence, type KeyEventLike } from './keys';
import { untrack } from 'svelte';

export type Scope = 'overlay' | 'queue' | 'page' | 'global';

export interface Binding {
  /** One or more key specs: `['j', 'down']` or `['g g']`. */
  keys: string[];
  scope: Scope;
  group: string;
  description: string;
  /** Include in the always-visible hint bar. */
  hint?: boolean;
  /** Shown in the help overlay only when this returns true. */
  when?: () => boolean;
  run: () => void | Promise<void>;
}

export interface KeyboardRouterOptions {
  /** Scopes to consult, highest priority first. */
  activeScopes: () => Scope[];
  now?: () => number;
  /** How long a partial sequence stays pending. */
  sequenceTimeoutMs?: number;
  /** Injected for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Called when a sequence is started/abandoned, for the status line. */
  onPendingChange?: (pending: string | null) => void;
}

export interface HandleOptions {
  /** True when the event originated in a text field. */
  editable?: boolean;
  /** Chords allowed to work while typing in a field. */
  allowWhileEditable?: boolean;
}

const ESCAPE_LIKE = new Set(['escape']);

export class KeyboardRouter {
  /**
   * `$state.raw`, not `$state`: deep proxying would replace every binding with a
   * proxy, breaking identity — and identity is what `unregister()` and the
   * overlay checks rely on. Mutations reassign the array, so reactivity holds.
   */
  bindings = $state.raw<Binding[]>([]);

  private readonly options: KeyboardRouterOptions;
  private pending = '';
  private timer: unknown = null;

  constructor(options: KeyboardRouterOptions) {
    this.options = options;
  }

  /**
   * Register one binding; returns an unregister function.
   *
   * The read of `bindings` is untracked on purpose: a caller that registers from
   * inside an `$effect` would otherwise depend on `bindings` and be invalidated by
   * its own write — looping until Svelte's update-depth guard trips.
   */
  register(binding: Binding): () => void {
    this.bindings = [...untrack(() => this.bindings), binding];
    return () => this.unregister(binding);
  }

  registerAll(bindings: Binding[]): () => void {
    this.bindings = [...untrack(() => this.bindings), ...bindings];
    return () => {
      for (const binding of bindings) this.unregister(binding);
    };
  }

  /**
   * Remove a binding by identity. Bindings are stored as given (never copied)
   * so that the object a caller registered is also the object it can check with
   * `hints()`/`grouped()` and the one `unregister` matches.
   */
  unregister(binding: Binding): void {
    // Untracked for the same reason as `registerAll`: the caller may be an effect.
    this.bindings = untrack(() => this.bindings).filter((existing) => existing !== binding);
  }

  /** Bindings for the help overlay, grouped by their group label. */
  grouped(): { group: string; bindings: Binding[] }[] {
    const groups = new Map<string, Binding[]>();
    for (const binding of this.bindings) {
      if (binding.when && !binding.when()) continue;
      const list = groups.get(binding.group);
      if (list) list.push(binding);
      else groups.set(binding.group, [binding]);
    }
    return [...groups.entries()].map(([group, list]) => ({ group, bindings: list }));
  }

  /** Short, always-visible hints for the current context. */
  hints(): Binding[] {
    const scopes = this.options.activeScopes();
    return this.bindings.filter(
      (binding) =>
        binding.hint === true &&
        scopes.includes(binding.scope) &&
        (!binding.when || binding.when()),
    );
  }

  get pendingSequence(): string {
    return this.pending;
  }

  /**
   * Route one key event.
   * Returns true when the key was consumed (the caller should preventDefault).
   */
  handle(event: KeyEventLike, options: HandleOptions = {}): boolean {
    const token = chordOf(event);

    if (options.editable) {
      const allowed = ESCAPE_LIKE.has(token) || options.allowWhileEditable === true;
      if (!allowed) return false;
    }

    const candidate = this.pending ? `${this.pending} ${token}` : token;
    const scopes = this.options.activeScopes();

    for (const scope of scopes) {
      const candidates = this.bindings.filter(
        (binding) => binding.scope === scope && (!binding.when || binding.when()),
      );
      if (candidates.length === 0) continue;

      const exact = candidates.find((binding) => matches(binding, candidate));
      if (exact) {
        this.clearPending();
        void exact.run();
        return true;
      }

      const isPrefix = candidates.some((binding) =>
        binding.keys.some(
          (spec) =>
            isSequencePrefix(candidate, spec) &&
            parseSequence(spec).length > parseSequence(candidate).length,
        ),
      );
      if (isPrefix) {
        this.setPending(candidate);
        return true;
      }
    }

    // Nothing matched the extended sequence. Drop the prefix and give the key
    // itself a chance (so `g` followed by an unbound key is not swallowed).
    if (this.pending) {
      this.clearPending();
      return this.handle(event, { ...options, editable: false });
    }
    return false;
  }

  /** Reset a half-typed sequence (Escape, overlay change, focus loss). */
  clearPending(): void {
    if (!this.pending) return;
    this.pending = '';
    if (this.timer !== null) {
      this.options.clearTimer?.(this.timer);
      this.timer = null;
    }
    this.options.onPendingChange?.(null);
  }

  private setPending(sequence: string): void {
    this.pending = sequence;
    this.options.onPendingChange?.(sequence);
    if (this.timer !== null) this.options.clearTimer?.(this.timer);
    const setTimer = this.options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.timer = setTimer(() => {
      this.timer = null;
      this.clearPending();
    }, this.options.sequenceTimeoutMs ?? 1200);
  }
}

function matches(binding: Binding, candidate: string): boolean {
  return binding.keys.some((spec) => canonicalSpec(spec) === candidate);
}

/**
 * Canonical form of a written key spec ('Ctrl+D' -> 'ctrl+d'), memoised because
 * it runs on every keystroke for every binding.
 */
const specCache = new Map<string, string>();

function canonicalSpec(spec: string): string {
  const cached = specCache.get(spec);
  if (cached !== undefined) return cached;
  const canonical = parseSequence(spec).join(' ');
  specCache.set(spec, canonical);
  return canonical;
}
