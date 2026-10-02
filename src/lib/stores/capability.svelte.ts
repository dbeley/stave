/**
 * Single source of truth for the input capability of the current device.
 *
 * A coarse pointer (touch screen) means the app renders its touch shell;
 * otherwise it keeps the keyboard-driven terminal shell. The value is derived
 * from the `(pointer: coarse)` media query so it also reacts to changes at
 * runtime (for example plugging in a mouse on Android).
 */

export type Shell = 'touch' | 'terminal';

export interface MediaQueryLike {
  matches: boolean;
  addEventListener?(type: 'change', listener: () => void): void;
  removeEventListener?(type: 'change', listener: () => void): void;
}

export interface CapabilityOptions {
  matchMedia?: (query: string) => MediaQueryLike | null;
}

export class CapabilityStore {
  private readonly resolve: (query: string) => MediaQueryLike | null;
  private readonly query: MediaQueryLike | null;
  private touchState = $state(false);

  constructor(options: CapabilityOptions = {}) {
    this.resolve =
      options.matchMedia ??
      ((q) => (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(q) : null));
    this.query = this.resolve('(pointer: coarse)');
    this.touchState = this.query?.matches ?? false;
    this.query?.addEventListener?.('change', this.onChange);
  }

  private onChange = (): void => {
    this.touchState = this.query?.matches ?? false;
  };

  get touch(): boolean {
    return this.touchState;
  }

  get shell(): Shell {
    return this.touchState ? 'touch' : 'terminal';
  }

  refresh(): void {
    this.onChange();
  }

  dispose(): void {
    this.query?.removeEventListener?.('change', this.onChange);
  }
}

export function applyShellToDocument(
  shell: Shell,
  root: HTMLElement | null = globalThis.document?.documentElement ?? null,
): void {
  if (root) root.dataset.shell = shell;
}
