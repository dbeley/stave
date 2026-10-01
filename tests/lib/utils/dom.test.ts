import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  appRoot,
  clamp,
  closestWithAttribute,
  isEditableTarget,
  moveIndex,
  prefersReducedMotion,
  scrollIntoViewIfNeeded,
  uniqueId,
} from '$lib/utils/dom';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isEditableTarget', () => {
  it('is true for input, textarea and select elements', () => {
    expect(isEditableTarget(document.createElement('input'))).toBe(true);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(document.createElement('select'))).toBe(true);
  });

  it('is false for an element that reports isContentEditable=false', () => {
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: false, configurable: true });
    expect(isEditableTarget(div)).toBe(false);
  });

  it('returns a boolean for a plain div when isContentEditable is undefined', () => {
    // BUG (src/lib/utils/dom.ts:8): the function returns `target.isContentEditable`
    // verbatim. jsdom does not implement that property (and some exotic hosts
    // leave it undefined), so the declared `boolean` return is actually
    // `undefined`; callers relying on `=== false` see the wrong value.
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
  });

  it('is true for a contenteditable element', () => {
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true });
    expect(isEditableTarget(div)).toBe(true);
  });

  it('is false for null and non-HTMLElement targets', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });
});

describe('closestWithAttribute', () => {
  it('finds the nearest ancestor carrying the attribute', () => {
    const row = document.createElement('div');
    row.setAttribute('data-row', '3');
    const span = document.createElement('span');
    row.appendChild(span);

    expect(closestWithAttribute(span, 'data-row')).toBe(row);
  });

  it('returns null when no ancestor matches', () => {
    const orphan = document.createElement('div');
    expect(closestWithAttribute(orphan, 'data-row')).toBeNull();
  });

  it('returns null for null or non-HTMLElement targets', () => {
    expect(closestWithAttribute(null, 'data-row')).toBeNull();
    expect(closestWithAttribute({} as EventTarget, 'data-row')).toBeNull();
  });
});

describe('clamp', () => {
  it('returns values inside the range unchanged', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to the bounds', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('maps NaN to the minimum', () => {
    expect(clamp(NaN, 3, 7)).toBe(3);
  });
});

describe('moveIndex', () => {
  it('returns 0 for an empty list', () => {
    expect(moveIndex(0, 1, 0)).toBe(0);
    expect(moveIndex(5, -1, -3)).toBe(0);
  });

  it('clamps at the ends when wrap is off', () => {
    expect(moveIndex(0, -1, 3)).toBe(0);
    expect(moveIndex(2, 1, 3)).toBe(2);
    expect(moveIndex(1, 1, 3)).toBe(2);
  });

  it('wraps around when wrap is on', () => {
    expect(moveIndex(0, -1, 3, { wrap: true })).toBe(2);
    expect(moveIndex(2, 1, 3, { wrap: true })).toBe(0);
    expect(moveIndex(1, 5, 3, { wrap: true })).toBe(0);
  });
});

describe('prefersReducedMotion', () => {
  it('reflects the media query (stubbed false in setup)', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('is true when the media query matches', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    expect(prefersReducedMotion()).toBe(true);
  });

  it('is false when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('uniqueId', () => {
  it('prefixes the id and produces unique values', () => {
    const a = uniqueId();
    const b = uniqueId();
    expect(a).toMatch(/^id-/);
    expect(a).not.toBe(b);
  });

  it('honours a custom prefix', () => {
    expect(uniqueId('queue')).toMatch(/^queue-/);
  });
});

describe('appRoot', () => {
  it('returns null when there is no #app element', () => {
    expect(appRoot()).toBeNull();
  });

  it('returns the #app element when present', () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);
    try {
      expect(appRoot()).toBe(root);
    } finally {
      root.remove();
    }
  });
});

describe('scrollIntoViewIfNeeded', () => {
  it('does nothing for a missing element', () => {
    expect(() => scrollIntoViewIfNeeded(null)).not.toThrow();
    expect(() => scrollIntoViewIfNeeded(undefined)).not.toThrow();
  });

  it('calls scrollIntoView on the element', () => {
    const el = document.createElement('div');
    const spy = vi.spyOn(el, 'scrollIntoView').mockImplementation(() => {});
    scrollIntoViewIfNeeded(el);
    expect(spy).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  it('ignores an element without scrollIntoView', () => {
    const fake = { scrollIntoView: undefined } as unknown as HTMLElement;
    expect(() => scrollIntoViewIfNeeded(fake)).not.toThrow();
  });
});
