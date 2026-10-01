import { describe, expect, it } from 'vitest';
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  SettingsStore,
  THEMES,
  applyThemeToDocument,
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
