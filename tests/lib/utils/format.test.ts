import { describe, it, expect } from 'vitest';
import {
  countAlbums,
  countTracks,
  formatAlbumSubtitle,
  formatBytes,
  formatCount,
  formatDuration,
  formatLongDuration,
  pluralize,
  truncate,
} from '$lib/utils/format';

describe('formatDuration', () => {
  it('formats sub-hour durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(215)).toBe('3:35');
    expect(formatDuration(3599)).toBe('59:59');
  });

  it('formats hour-plus durations as h:mm:ss', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(7325)).toBe('2:02:05');
  });

  it('floors fractional seconds', () => {
    expect(formatDuration(59.9)).toBe('0:59');
    expect(formatDuration(0.4)).toBe('0:00');
  });

  it('returns the placeholder for undefined, negative or non-finite input', () => {
    expect(formatDuration(undefined)).toBe('--:--');
    expect(formatDuration(-1)).toBe('--:--');
    expect(formatDuration(NaN)).toBe('--:--');
    expect(formatDuration(Infinity)).toBe('--:--');
    expect(formatDuration(-Infinity)).toBe('--:--');
  });
});

describe('formatLongDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatLongDuration(12)).toBe('12 s');
    expect(formatLongDuration(59)).toBe('59 s');
    expect(formatLongDuration(60)).toBe('1 min');
    expect(formatLongDuration(90)).toBe('1 min');
    expect(formatLongDuration(3599)).toBe('59 min');
    expect(formatLongDuration(3600)).toBe('1 h 00 min');
    expect(formatLongDuration(3725)).toBe('1 h 02 min');
  });

  it('returns an em dash for zero, negatives and non-finite input', () => {
    expect(formatLongDuration(undefined)).toBe('—');
    expect(formatLongDuration(0)).toBe('—');
    expect(formatLongDuration(-5)).toBe('—');
    expect(formatLongDuration(NaN)).toBe('—');
    expect(formatLongDuration(Infinity)).toBe('—');
  });
});

describe('formatCount', () => {
  it('leaves small values untouched', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(12)).toBe('12');
    expect(formatCount(999)).toBe('999');
  });

  it('abbreviates thousands with a k suffix', () => {
    expect(formatCount(1000)).toBe('1k');
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(1536)).toBe('1.5k');
    expect(formatCount(10_000)).toBe('10k');
    expect(formatCount(999_999)).toBe('1000k');
  });

  it('abbreviates millions with an M suffix', () => {
    expect(formatCount(1_000_000)).toBe('1M');
    expect(formatCount(1_500_000)).toBe('1.5M');
    expect(formatCount(2_400_000)).toBe('2.4M');
  });

  it('keeps the sign for negative counts', () => {
    expect(formatCount(-1500)).toBe('-1.5k');
  });

  it('returns 0 for non-finite input', () => {
    expect(formatCount(NaN)).toBe('0');
    expect(formatCount(Infinity)).toBe('0');
    expect(formatCount(-Infinity)).toBe('0');
  });
});

describe('formatBytes', () => {
  it('renders whole bytes without a decimal', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(3.5)).toBe('4 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('steps up through KB, MB, GB and TB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10 * 1024)).toBe('10 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GB');
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB');
  });

  it('returns an em dash for zero, negatives and non-finite input', () => {
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(0)).toBe('—');
    expect(formatBytes(-100)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
    expect(formatBytes(Infinity)).toBe('—');
  });
});

describe('formatAlbumSubtitle', () => {
  it('joins artist and year with a middot', () => {
    expect(formatAlbumSubtitle('Aurelia Vance', 2020)).toBe('Aurelia Vance · 2020');
  });

  it('omits missing parts', () => {
    expect(formatAlbumSubtitle('Aurelia Vance', undefined)).toBe('Aurelia Vance');
    expect(formatAlbumSubtitle(undefined, 2020)).toBe('2020');
    expect(formatAlbumSubtitle(undefined, undefined)).toBe('');
    expect(formatAlbumSubtitle('', 0)).toBe('');
  });
});

describe('pluralize', () => {
  it('uses the singular for exactly one', () => {
    expect(pluralize(1, 'album')).toBe('album');
  });

  it('appends an s for other counts', () => {
    expect(pluralize(0, 'album')).toBe('albums');
    expect(pluralize(2, 'album')).toBe('albums');
    expect(pluralize(-1, 'album')).toBe('albums');
  });

  it('honours an explicit irregular plural', () => {
    expect(pluralize(2, 'child', 'children')).toBe('children');
    expect(pluralize(1, 'child', 'children')).toBe('child');
  });
});

describe('countAlbums / countTracks', () => {
  it('renders album counts', () => {
    expect(countAlbums(1)).toBe('1 album');
    expect(countAlbums(5)).toBe('5 albums');
    expect(countAlbums(0)).toBe('0 albums');
  });

  it('renders track counts', () => {
    expect(countTracks(1)).toBe('1 track');
    expect(countTracks(5)).toBe('5 tracks');
    expect(countTracks(0)).toBe('0 tracks');
  });
});

describe('truncate', () => {
  it('leaves short-enough text alone', () => {
    expect(truncate('hello', 5)).toBe('hello');
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('', 3)).toBe('');
  });

  it('cuts to max length and appends an ellipsis', () => {
    expect(truncate('hello', 4)).toBe('hel…');
    expect(truncate('hello', 1)).toBe('…');
    expect(truncate('hello', 0)).toBe('…');
  });
});
