import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ app: {} as Record<string, any> }));

vi.mock('$lib/app.svelte', () => ({ app: h.app }));

import { coverArtIdFor, coverArtUrl } from '$lib/ui/coverArt';
import { COVER_SIZE } from '$lib/config';

beforeEach(() => {
  for (const key of Object.keys(h.app)) delete h.app[key];
});

describe('coverArtUrl', () => {
  it('returns undefined without a cover id and does not touch the client', () => {
    h.app.getClient = vi.fn();

    expect(coverArtUrl(undefined)).toBeUndefined();
    expect(h.app.getClient).not.toHaveBeenCalled();
  });

  it('returns undefined when not connected', () => {
    h.app.getClient = vi.fn(() => null);

    expect(coverArtUrl('cov1')).toBeUndefined();
  });

  it('asks the client for the requested size', () => {
    const client = { coverArtUrl: vi.fn((id: string, size: number) => `url/${id}/${size}`) };
    h.app.getClient = vi.fn(() => client);

    expect(coverArtUrl('cov1', 300)).toBe('url/cov1/300');
    expect(client.coverArtUrl).toHaveBeenCalledWith('cov1', 300);
  });

  it('defaults to the configured list size', () => {
    const client = { coverArtUrl: vi.fn(() => 'url') };
    h.app.getClient = vi.fn(() => client);

    coverArtUrl('cov1');

    expect(client.coverArtUrl).toHaveBeenCalledWith('cov1', COVER_SIZE.list);
  });
});

describe('coverArtIdFor', () => {
  it("prefers the entity's own cover id", () => {
    h.app.library = { albumDetail: vi.fn() };

    expect(coverArtIdFor({ coverArtId: 'own', albumId: 'al1' })).toBe('own');
    expect(h.app.library.albumDetail).not.toHaveBeenCalled();
  });

  it("falls back to the album's cover from the library", () => {
    h.app.library = { albumDetail: vi.fn(() => ({ album: { coverArtId: 'album-cover' } })) };

    expect(coverArtIdFor({ albumId: 'al1' })).toBe('album-cover');
    expect(h.app.library.albumDetail).toHaveBeenCalledWith('al1');
  });

  it('returns undefined when the album has no cover', () => {
    h.app.library = { albumDetail: vi.fn(() => ({ album: undefined })) };

    expect(coverArtIdFor({ albumId: 'al1' })).toBeUndefined();
  });

  it('returns undefined when there is neither a cover nor an album id', () => {
    expect(coverArtIdFor({})).toBeUndefined();
  });
});
