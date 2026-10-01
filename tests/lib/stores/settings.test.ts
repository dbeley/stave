import { describe, expect, it } from 'vitest';
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  HOST_THEME,
  SETTINGS_KEY,
  SettingsStore,
  THEMES,
  applyThemeToDocument,
  themeChoices,
} from '$lib/stores/settings.svelte';
import { memoryStorage } from '../../helpers/storage';

describe('SettingsStore', () => {
  it('starts from the defaults', () => {
    const store = new SettingsStore(undefined, null);
    expect(store.state.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(store.state.autoDj).toBe(true);
    expect(store.state.offlineCacheEnabled).toBe(false);
    expect(store.state.scrobblingEnabled).toBe(true);
    expect(store.state.streamMaxBitRate).toBe(0);
  });

  it('applies an initial patch over the defaults', () => {
    const store = new SettingsStore({ theme: 'amoled', autoDj: false }, null);
    expect(store.state.theme).toBe('amoled');
    expect(store.state.autoDj).toBe(false);
    expect(store.state.accent).toBe(DEFAULT_SETTINGS.accent);
  });

  it('persists updates and reloads them', () => {
    const storage = memoryStorage();
    const store = new SettingsStore(undefined, storage);
    store.update({ theme: 'light', crtEffects: true });

    expect(storage.map.has(SETTINGS_KEY)).toBe(true);

    const reloaded = new SettingsStore(undefined, storage);
    expect(reloaded.state.theme).toBe('light');
    expect(reloaded.state.crtEffects).toBe(true);
  });

  it('picks up newly added fields from the defaults on reload', () => {
    const storage = memoryStorage();
    const store = new SettingsStore(undefined, storage);
    store.update({ theme: 'light' });

    const reloaded = new SettingsStore(undefined, storage);
    expect(reloaded.state.theme).toBe('light');
    // Fields the stored blob never had must still have sane values.
    expect(reloaded.state.pageSize).toBe(DEFAULT_SETTINGS.pageSize);
    expect(reloaded.state.keyHints).toBe(true);
  });

  it('falls back to defaults when the stored blob is corrupt', () => {
    const storage = memoryStorage({ [SETTINGS_KEY]: '{not json' });
    const store = new SettingsStore(undefined, storage);
    expect(store.state.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('works without any storage at all', () => {
    const store = new SettingsStore(undefined, null);
    expect(() => store.update({ theme: 'light' })).not.toThrow();
    expect(store.state.theme).toBe('light');
  });

  it('toggles booleans', () => {
    const store = new SettingsStore({ autoDj: true }, null);
    store.toggle('autoDj');
    expect(store.state.autoDj).toBe(false);
    store.toggle('autoDj');
    expect(store.state.autoDj).toBe(true);

    store.toggle('offlineCacheEnabled');
    expect(store.state.offlineCacheEnabled).toBe(true);
  });

  it('cycles themes and accents, wrapping around', () => {
    const store = new SettingsStore({ theme: 'dark', accent: 'orange' }, null);
    store.cycleTheme();
    expect(store.state.theme).toBe(THEMES[1]);
    store.cycleTheme(-1);
    expect(store.state.theme).toBe('dark');
    store.cycleTheme(-1);
    expect(store.state.theme).toBe(THEMES[THEMES.length - 1]);

    store.cycleAccent();
    expect(store.state.accent).toBe(ACCENTS[1]);
    store.cycleAccent(-1);
    expect(store.state.accent).toBe(ACCENTS[0]);
  });

  it('resets every field back to the defaults', () => {
    const store = new SettingsStore({ theme: 'light', autoDj: false, volume: 0.1 }, null);
    store.reset();
    expect(store.state.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(store.state.autoDj).toBe(DEFAULT_SETTINGS.autoDj);
    expect(store.state.volume).toBe(DEFAULT_SETTINGS.volume);
  });
});

describe('applyThemeToDocument', () => {
  it('writes the theme, accent and crt flags onto the root element', () => {
    const root = document.createElement('div');
    applyThemeToDocument({ theme: 'amoled', accent: 'moss', crtEffects: true }, root);
    expect(root.dataset.theme).toBe('amoled');
    expect(root.dataset.accent).toBe('moss');
    expect(root.dataset.crt).toBe('on');

    applyThemeToDocument({ theme: 'dark', accent: 'orange', crtEffects: false }, root);
    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.crt).toBe('off');
  });

  it('is a no-op without a root element', () => {
    expect(() =>
      applyThemeToDocument({ theme: 'dark', accent: 'mono', crtEffects: false }, null),
    ).not.toThrow();
  });
});

describe('host palette (stylix)', () => {
  it('offers the host theme only when a palette is present', () => {
    expect(themeChoices(false)).toEqual(THEMES);
    expect(themeChoices(true)).toEqual([...THEMES, HOST_THEME]);
    // Default argument follows the runtime config, which is absent under vitest.
    expect(themeChoices()).toEqual(THEMES);
  });

  it('applies the palette as inline custom properties', () => {
    const root = document.createElement('div');
    applyThemeToDocument({ theme: HOST_THEME, accent: 'orange', crtEffects: false }, root, {
      bg: '#101418',
      fg: '#e8e6e3',
      accent: '#7aa2f7',
      border: '#2a2e3a',
    });

    expect(root.dataset.theme).toBe('host');
    expect(root.style.getPropertyValue('--bg')).toBe('#101418');
    expect(root.style.getPropertyValue('--fg')).toBe('#e8e6e3');
    expect(root.style.getPropertyValue('--accent')).toBe('#7aa2f7');
    expect(root.style.getPropertyValue('--border')).toBe('#2a2e3a');
    // The palette says nothing about light/dark, so it is inferred from the bg.
    expect(root.style.colorScheme).toBe('dark');
  });

  it('infers a light color-scheme from a light background', () => {
    const root = document.createElement('div');
    applyThemeToDocument({ theme: HOST_THEME, accent: 'mono', crtEffects: false }, root, {
      bg: '#faf4ed',
    });
    expect(root.style.colorScheme).toBe('light');
  });

  it('leaves keys the palette omits to the stylesheet', () => {
    const root = document.createElement('div');
    applyThemeToDocument({ theme: HOST_THEME, accent: 'orange', crtEffects: false }, root, {
      bg: '#101418',
    });
    expect(root.style.getPropertyValue('--bg')).toBe('#101418');
    expect(root.style.getPropertyValue('--fg')).toBe('');
  });

  it('clears the inline colours when switching back to a built-in theme', () => {
    // Without this the host colours would stick: inline properties outrank the
    // [data-theme] blocks, so picking "dark" would appear to do nothing.
    const root = document.createElement('div');
    const palette = { bg: '#101418', fg: '#e8e6e3', accent: '#7aa2f7' };
    applyThemeToDocument({ theme: HOST_THEME, accent: 'orange', crtEffects: false }, root, palette);
    expect(root.style.getPropertyValue('--bg')).toBe('#101418');

    applyThemeToDocument({ theme: 'dark', accent: 'orange', crtEffects: false }, root, palette);
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.getPropertyValue('--bg')).toBe('');
    expect(root.style.getPropertyValue('--accent')).toBe('');
    expect(root.style.colorScheme).toBe('');
  });

  it('does nothing extra for a built-in theme even when a palette exists', () => {
    const root = document.createElement('div');
    applyThemeToDocument({ theme: 'amoled', accent: 'orange', crtEffects: false }, root, {
      bg: '#101418',
    });
    expect(root.style.getPropertyValue('--bg')).toBe('');
  });
});
