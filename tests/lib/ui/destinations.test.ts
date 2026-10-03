import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/app.svelte', () => ({
  app: {
    router: { navigate: vi.fn() },
    focusSearch: vi.fn(),
    ui: { openOverlay: vi.fn() },
    search: { state: { query: '' } },
    capability: { shell: 'terminal' },
  },
  App: class {},
}));
import { DESTINATIONS, NAV_DESTINATIONS } from '$lib/ui/destinations';

describe('destinations', () => {
  it('has unique mnemonic keys', () => {
    const keys = DESTINATIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('nav destinations are a subset of all destinations', () => {
    for (const d of NAV_DESTINATIONS) expect(DESTINATIONS).toContain(d);
  });
  it('exposes the four expected tabs in order', () => {
    expect(NAV_DESTINATIONS.map((d) => d.label)).toEqual([
      'home',
      'albums',
      'artists',
      'now playing',
    ]);
  });
  it('maps detail routes to their parent tab', () => {
    const albums = NAV_DESTINATIONS.find((d) => d.label === 'albums')!;
    expect(albums.nav!.activeOn).toContain('album');
    const artists = NAV_DESTINATIONS.find((d) => d.label === 'artists')!;
    expect(artists.nav!.activeOn).toContain('artist');
  });
});
