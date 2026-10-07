import { describe, it, expect } from 'vitest';
import { fittedIndexes } from '$lib/utils/fit';

const item = (width: number, pinned = false) => ({ width, pinned });

describe('fittedIndexes', () => {
  it('keeps everything when the layout is not known yet', () => {
    // jsdom measures every element as 0, and so does the first paint; blanking
    // the row there would be a worse failure than an overfull one.
    expect(fittedIndexes([item(80), item(80), item(80)], 0, 10)).toEqual([0, 1, 2]);
    expect(fittedIndexes([], 500, 10)).toEqual([]);
  });

  it('keeps everything when it all fits', () => {
    // 80 + 10 + 80 + 10 + 80 = 260
    expect(fittedIndexes([item(80), item(80), item(80)], 260, 10)).toEqual([0, 1, 2]);
  });

  it('drops the tail that does not fit, whole', () => {
    // Room for two and the gap between them, not the third.
    expect(fittedIndexes([item(80), item(80), item(80)], 190, 10)).toEqual([0, 1]);
  });

  it('counts the gap between entries, not at the ends', () => {
    const items = [item(50), item(50), item(50)];
    expect(fittedIndexes(items, 100, 25)).toEqual([0]); // 50 + 25 + 50 = 125 > 100
    expect(fittedIndexes(items, 125, 25)).toEqual([0, 1]);
  });

  it('never drops a pinned entry, and appends it after the prefix', () => {
    // The pinned one is offered last, but it is the way out: its width is
    // reserved first, and the prefix gets what is left (9 + 30 + 80 = 119).
    const items = [item(80), item(80), item(80), item(9, true)];
    expect(fittedIndexes(items, 119, 30)).toEqual([0, 3]);
  });

  it('shows the pinned entry even when it alone does not fit', () => {
    expect(fittedIndexes([item(80), item(200, true)], 100, 0)).toEqual([1]);
  });

  it('takes nothing when not even one entry fits', () => {
    expect(fittedIndexes([item(80), item(80)], 50, 0)).toEqual([]);
  });
});
