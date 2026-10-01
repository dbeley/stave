/**
 * Transient status-line messages. In a terminal UI there is no room for modal
 * dialogs, so feedback lands on the same line as the key hints and fades out.
 */

export type ToastKind = 'info' | 'ok' | 'warn' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Absolute timestamp, useful for tests. */
  at: number;
}

export const DEFAULT_TOAST_MS = 4000;

export class ToastStore {
  readonly state: { items: Toast[] };

  private nextId = 1;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly ttlMs: number;

  constructor(
    options: {
      now?: () => number;
      schedule?: (fn: () => void, ms: number) => unknown;
      ttlMs?: number;
      initial?: Toast[];
    } = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.ttlMs = options.ttlMs ?? DEFAULT_TOAST_MS;
    this.state = $state<{ items: Toast[] }>({ items: options.initial ?? [] });
  }

  push(kind: ToastKind, message: string, ttlMs = this.ttlMs): Toast {
    const toast: Toast = { id: this.nextId++, kind, message, at: this.now() };
    this.state.items = [...this.state.items, toast];
    if (ttlMs > 0) {
      this.schedule(() => this.dismiss(toast.id), ttlMs);
    }
    return toast;
  }

  info(message: string): Toast {
    return this.push('info', message);
  }

  ok(message: string): Toast {
    return this.push('ok', message);
  }

  warn(message: string): Toast {
    return this.push('warn', message);
  }

  error(message: string): Toast {
    // Errors linger: they usually need the user to do something.
    return this.push('error', message, 8000);
  }

  dismiss(id: number): void {
    this.state.items = this.state.items.filter((toast) => toast.id !== id);
  }

  clear(): void {
    this.state.items = [];
  }

  /** Most recent message, for the single-line status bar. */
  get latest(): Toast | undefined {
    return this.state.items[this.state.items.length - 1];
  }
}

export const toasts = new ToastStore();
