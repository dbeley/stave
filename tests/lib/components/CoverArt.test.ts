import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

/**
 * `CoverArt` degrades from ASCII to the raw image to a generated pattern.
 * Cover URL resolution goes through `$lib/ui/coverArt`, which reads the app's
 * client, so the app is faked with a client that returns predictable URLs.
 */
const h = vi.hoisted(() => ({
  app: {} as Record<string, any>,
  coverArtUrl: vi.fn((id: string, size: number) => `https://example.test/cover/${id}?size=${size}`),
}));

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

import CoverArt from '$lib/components/CoverArt.svelte';

function install(hasClient = true) {
  const client = { coverArtUrl: h.coverArtUrl };
  for (const key of Object.keys(h.app)) delete h.app[key];
  Object.assign(h.app, { getClient: vi.fn(() => (hasClient ? client : null)) });
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CoverArt', () => {
  it('renders an <img> with the resolved url and alt in image mode', async () => {
    install();
    render(CoverArt, { props: { coverArtId: 'cov1', seed: 'al1', mode: 'image', size: 600 } });
    await tick();

    const img = screen.getByRole('img', { name: 'cover art' }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://example.test/cover/cov1?size=600');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(h.coverArtUrl).toHaveBeenCalledWith('cov1', 600);
  });

  it('honours a custom alt in image mode', async () => {
    install();
    render(CoverArt, {
      props: { coverArtId: 'cov1', seed: 'al1', mode: 'image', alt: 'Neon Cartography' },
    });
    await tick();

    expect(screen.getByRole('img', { name: 'Neon Cartography' })).toBeTruthy();
  });

  it('falls back to generated art when there is no cover id', async () => {
    install();
    render(CoverArt, { props: { seed: 'al1', mode: 'image' } });
    await tick();

    expect(screen.queryByRole('img')).toBeNull();
  });

  it('uses generated art (no <img>) when the client cannot resolve a url', async () => {
    install(false);
    render(CoverArt, { props: { coverArtId: 'cov1', seed: 'al1', mode: 'image' } });
    await tick();

    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders ASCII art by default rather than a raw image', async () => {
    install();
    render(CoverArt, { props: { coverArtId: 'cov1', seed: 'al1' } });
    await tick();

    expect(screen.queryByRole('img')).toBeNull();
  });
});
