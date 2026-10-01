/**
 * User settings — the single source of truth for everything the settings page
 * exposes. Persisted to localStorage; a fresh instance is created in tests.
 */

import { loadPersisted, savePersisted, type StorageLike, defaultStorage } from '$lib/utils/persist';
import { HOST_PALETTE, type HostPalette } from '$lib/config';
import { colorSchemeFor } from '$lib/utils/color';

/**
 * Built-in themes, plus `host` when the deployment supplies a palette (stylix).
 * `host` is deliberately not in THEMES: it is only selectable when it exists.
 */
export type Theme = 'dark' | 'light' | 'amoled' | 'host';

export type Accent = 'orange' | 'moss' | 'steel' | 'amber' | 'cyan' | 'magenta' | 'mono';

export const THEMES: readonly Theme[] = ['dark', 'light', 'amoled'];

/** Theme backed by the host's palette rather than our own tokens. */
export const HOST_THEME: Theme = 'host';

/**
 * Themes the user may pick. Exposed as a function (not a constant) because it
 * depends on the runtime config, which is injected before the app boots.
 */
export function themeChoices(hasPalette: boolean = HOST_PALETTE !== undefined): readonly Theme[] {
  return hasPalette ? [...THEMES, HOST_THEME] : THEMES;
}
export const ACCENTS: readonly Accent[] = [
  'orange',
  'moss',
  'steel',
  'amber',
  'cyan',
  'magenta',
  'mono',
];

/** Streaming quality: 0 keeps the original file (no transcoding). */
export const BITRATE_CHOICES = [0, 320, 192, 128, 96] as const;

export interface Settings {
  theme: Theme;
  accent: Accent;
  /** Scanline/chromatic overlay. Slightly expensive on low-end devices. */
  crtEffects: boolean;
  /** Render cover art as coloured ASCII (the dmt look). */
  asciiCoverArt: boolean;
  /** Keep the queue going with similar tracks when it runs dry. */
  autoDj: boolean;
  /** Refill once this many tracks remain. */
  autoDjThreshold: number;
  /** How many tracks each refill adds. */
  autoDjBatchSize: number;
  /** Download listen-later albums for offline playback. */
  offlineCacheEnabled: boolean;
  /** Report plays back to the server (`scrobble`). */
  scrobblingEnabled: boolean;
  /** Ask the server to transcode above this bitrate (0 = original). */
  streamMaxBitRate: number;
  /** 0..1 */
  volume: number;
  /** Rows per metadata request on list pages. */
  pageSize: number;
  /** Show the `j/k` style hint bar at the bottom. */
  keyHints: boolean;
  /** Extra columns (bitrate, format) in track lists. */
  showTechnicalColumns: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: 'orange',
  crtEffects: false,
  asciiCoverArt: true,
  autoDj: true,
  autoDjThreshold: 3,
  autoDjBatchSize: 10,
  offlineCacheEnabled: false,
  scrobblingEnabled: true,
  streamMaxBitRate: 0,
  volume: 0.8,
  pageSize: 50,
  keyHints: true,
  showTechnicalColumns: false,
};

export const SETTINGS_KEY = 'stave:settings';

export class SettingsStore {
  readonly state: Settings;

  private readonly storage: StorageLike | null;

  constructor(initial?: Partial<Settings>, storage?: StorageLike | null) {
    this.storage = storage === undefined ? defaultStorage() : storage;
    this.state = $state<Settings>({
      ...loadPersisted<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS, { storage: this.storage }),
      ...initial,
    });
  }

  /** Apply a patch and persist. This is the only supported write path. */
  update(patch: Partial<Settings>): void {
    Object.assign(this.state, patch);
    this.persist();
  }

  setTheme(theme: Theme): void {
    this.update({ theme });
  }

  setAccent(accent: Accent): void {
    this.update({ accent });
  }

  toggle(
    key:
      | 'crtEffects'
      | 'asciiCoverArt'
      | 'autoDj'
      | 'offlineCacheEnabled'
      | 'scrobblingEnabled'
      | 'keyHints'
      | 'showTechnicalColumns',
  ): void {
    this.update({ [key]: !this.state[key] } as Partial<Settings>);
  }

  /** Cycle through a list of choices (used by the keyboard shortcuts). */
  cycleAccent(direction = 1): void {
    const index = ACCENTS.indexOf(this.state.accent);
    this.setAccent(ACCENTS[(index + direction + ACCENTS.length) % ACCENTS.length]!);
  }

  cycleTheme(direction = 1): void {
    const choices = themeChoices();
    const index = choices.indexOf(this.state.theme);
    this.setTheme(choices[(index + direction + choices.length) % choices.length]!);
  }

  reset(): void {
    Object.assign(this.state, DEFAULT_SETTINGS);
    this.persist();
  }

  private persist(): void {
    savePersisted(SETTINGS_KEY, this.state, { storage: this.storage });
  }
}

/** Singleton used by the app; tests construct their own instance. */
export const settings = new SettingsStore();

/** Palette key → CSS custom property, matching the tokens in `app.css`. */
const PALETTE_VARS: Record<keyof HostPalette, string> = {
  bg: '--bg',
  bgElev: '--bg-elev',
  bgElev2: '--bg-elev-2',
  fg: '--fg',
  fgDim: '--fg-dim',
  fgFaint: '--fg-faint',
  border: '--border',
  borderFocus: '--border-focus',
  accent: '--accent',
  accentDim: '--accent-dim',
  ok: '--ok',
  warn: '--warn',
  danger: '--danger',
  info: '--info',
};

/** Apply the theme tokens to <html> (called from an effect in App.svelte). */
export function applyThemeToDocument(
  state: Pick<Settings, 'theme' | 'accent' | 'crtEffects'>,
  root: HTMLElement | null = globalThis.document?.documentElement ?? null,
  palette: HostPalette | undefined = HOST_PALETTE,
): void {
  if (!root) return;
  root.dataset.theme = state.theme;
  root.dataset.accent = state.accent;
  root.dataset.crt = state.crtEffects ? 'on' : 'off';

  // A host palette is applied as *inline* custom properties, which outrank the
  // stylesheet's [data-theme]/[data-accent] blocks. Clearing them on every other
  // theme is what makes switching back to a built-in one actually work.
  const active = state.theme === HOST_THEME ? palette : undefined;
  for (const [key, property] of Object.entries(PALETTE_VARS)) {
    const value = active?.[key as keyof HostPalette];
    if (value) root.style.setProperty(property, value);
    else root.style.removeProperty(property);
  }

  // The palette carries no light/dark intent, so infer it from the background.
  if (active) root.style.colorScheme = colorSchemeFor(active.bg);
  else root.style.removeProperty('color-scheme');
}
