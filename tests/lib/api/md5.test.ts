import { describe, it, expect } from 'vitest';
import { md5 } from '$lib/api/md5';

/**
 * RFC 1321 test vectors (section A.5) plus multi-block, UTF-8 and byte-array
 * inputs. The implementation is in-repo, so these vectors are the contract.
 */
const RFC_VECTORS: ReadonlyArray<readonly [string, string]> = [
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['a', '0cc175b9c0f1b6a831c399e269772661'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
  [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    'd174ab98d277d9f5a5611c2c9f419d9f',
  ],
  [
    '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
    '57edf4a22be3c955ac49da2e2107b67a',
  ],
];

describe('md5', () => {
  it.each(RFC_VECTORS)('matches the RFC 1321 vector for %j', (input, expected) => {
    expect(md5(input)).toBe(expected);
  });

  it('returns a 32-character lowercase hex string', () => {
    const digest = md5('anything');
    expect(digest).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic', () => {
    expect(md5('repeat me')).toBe(md5('repeat me'));
  });

  describe('multi-block input', () => {
    it('hashes exactly 64 bytes (a full block before padding)', () => {
      expect(md5('x'.repeat(64))).toBe('c1bb4f81d892b2d57947682aeb252456');
    });

    it('hashes 65 bytes (padding spills into a second block)', () => {
      expect(md5('y'.repeat(65))).toBe('38161025084d46d907d3b9a61a1286c9');
    });

    it('hashes a length that needs the length word in its own block (56 bytes)', () => {
      expect(md5('m'.repeat(56))).toBe('a6b24c5356257d0e18e494030514e44e');
    });

    it('hashes 55 bytes (length word still fits in the block)', () => {
      expect(md5('n'.repeat(55))).toBe('74ba8010c8620e59201612ce11c5f71e');
    });

    it('hashes 1000 bytes spanning many blocks', () => {
      expect(md5('z'.repeat(1000))).toBe('93f8e2ed34e2c6727cf1ee6f138267e9');
    });
  });

  describe('UTF-8 input', () => {
    it('hashes a multi-byte string using its UTF-8 encoding', () => {
      // "héllo wörld — 日本語 🎵" — 32 bytes, mixes 2-, 3- and 4-byte sequences.
      expect(md5('héllo wörld — 日本語 🎵')).toBe('b431c12e12cca077633a886e6880fa1f');
    });

    it('treats a multi-byte string the same as its explicit UTF-8 bytes', () => {
      const text = 'héllo wörld — 日本語 🎵';
      expect(md5(text)).toBe(md5(new TextEncoder().encode(text)));
    });
  });

  describe('Uint8Array input', () => {
    it('hashes raw bytes identically to the equivalent ASCII string', () => {
      expect(md5(new TextEncoder().encode('abc'))).toBe(md5('abc'));
    });

    it('hashes bytes above 0x7f correctly', () => {
      // The five bytes of "héllo".
      const bytes = new TextEncoder().encode('héllo');
      expect(md5(bytes)).toBe(md5('héllo'));
      expect(md5(bytes)).toHaveLength(32);
    });

    it('hashes an empty byte array like the empty string', () => {
      expect(md5(new Uint8Array(0))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    });

    it('does not mutate the input array', () => {
      const bytes = new TextEncoder().encode('abc');
      const copy = bytes.slice();
      md5(bytes);
      expect(bytes).toEqual(copy);
    });
  });
});
