import { describe, it, expect } from 'vitest';
import { ResponseCache } from '$lib/api/cache';

/** A controllable clock: tests advance `now` explicitly, never wall time. */
function fakeClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('ResponseCache', () => {
  describe('basic get/set', () => {
    it('returns undefined for a key that was never set', () => {
      const cache = new ResponseCache();
      expect(cache.get('missing')).toBeUndefined();
    });

    it('stores and returns a value', () => {
      const cache = new ResponseCache();
      cache.set('a', { hello: 'world' });
      expect(cache.get('a')).toEqual({ hello: 'world' });
    });

    it('exposes the entry count through size', () => {
      const cache = new ResponseCache();
      expect(cache.size).toBe(0);
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.size).toBe(2);
    });

    it('clear() empties the cache', () => {
      const cache = new ResponseCache();
      cache.set('a', 1);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('TTL expiry', () => {
    it('serves an entry before it expires', () => {
      const clock = fakeClock(1_000);
      const cache = new ResponseCache({ ttlMs: 100, now: clock.now });
      cache.set('a', 'v');
      clock.advance(99);
      expect(cache.get('a')).toBe('v');
    });

    it('drops an entry once now reaches expiresAt', () => {
      const clock = fakeClock(1_000);
      const cache = new ResponseCache({ ttlMs: 100, now: clock.now });
      cache.set('a', 'v');
      clock.advance(100);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it('honours a per-entry ttl override', () => {
      const clock = fakeClock(0);
      const cache = new ResponseCache({ ttlMs: 10_000, now: clock.now });
      cache.set('short', 'v', 50);
      cache.set('long', 'w', 5_000);
      clock.advance(51);
      expect(cache.get('short')).toBeUndefined();
      expect(cache.get('long')).toBe('w');
    });
  });

  describe('LRU eviction', () => {
    it('evicts the oldest entry once maxEntries is reached', () => {
      const cache = new ResponseCache({ maxEntries: 2, now: () => 0 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.size).toBe(2);
    });

    it('treats a get() as a use and spares the entry from eviction', () => {
      const cache = new ResponseCache({ maxEntries: 2, now: () => 0 });
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.get('a')).toBe(1); // 'a' is now the most recently used
      cache.set('c', 3);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
    });

    it('keeps the cache at maxEntries across many inserts', () => {
      const cache = new ResponseCache({ maxEntries: 3, now: () => 0 });
      for (let i = 0; i < 20; i += 1) cache.set(`k${i}`, i);
      expect(cache.size).toBe(3);
      expect(cache.get('k19')).toBe(19);
    });
  });

  describe('invalidate', () => {
    it('without prefixes clears everything', () => {
      const cache = new ResponseCache();
      cache.set('a', 1);
      cache.set('b', 2);
      cache.invalidate();
      expect(cache.size).toBe(0);
    });

    it('drops only entries whose key starts with the prefix', () => {
      const cache = new ResponseCache();
      cache.set('srv|user|getStarred2?', 1);
      cache.set('srv|user|getAlbumList2?type=newest', 2);
      cache.set('srv|user|search3?query=x', 3);
      cache.invalidate('srv|user|getStarred2', 'srv|user|getAlbumList2');
      expect(cache.get('srv|user|getStarred2?')).toBeUndefined();
      expect(cache.get('srv|user|getAlbumList2?type=newest')).toBeUndefined();
      expect(cache.get('srv|user|search3?query=x')).toBe(3);
    });

    it('does not treat the prefix as a substring match', () => {
      const cache = new ResponseCache();
      cache.set('prefixkey', 1);
      cache.set('other|prefixkey', 2);
      cache.invalidate('prefixkey');
      expect(cache.get('prefixkey')).toBeUndefined();
      expect(cache.get('other|prefixkey')).toBe(2);
    });
  });
});
