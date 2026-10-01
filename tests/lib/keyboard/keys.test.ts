import { describe, it, expect } from 'vitest';
import {
  chordOf,
  formatChord,
  isSequencePrefix,
  normalizeChordPart,
  normalizeKeyName,
  parseSequence,
  sequenceLength,
  type KeyEventLike,
} from '$lib/keyboard/keys';

describe('normalizeKeyName', () => {
  it('maps the named keys to short stable names', () => {
    expect(normalizeKeyName('ArrowUp')).toBe('up');
    expect(normalizeKeyName('ArrowDown')).toBe('down');
    expect(normalizeKeyName('ArrowLeft')).toBe('left');
    expect(normalizeKeyName('ArrowRight')).toBe('right');
    expect(normalizeKeyName('Escape')).toBe('escape');
    expect(normalizeKeyName('Esc')).toBe('escape');
    expect(normalizeKeyName('Enter')).toBe('enter');
    expect(normalizeKeyName(' ')).toBe('space');
    expect(normalizeKeyName('Spacebar')).toBe('space');
    expect(normalizeKeyName('Tab')).toBe('tab');
    expect(normalizeKeyName('PageDown')).toBe('pagedown');
  });

  it('lower-cases multi-character DOM keys but keeps printable characters as typed', () => {
    expect(normalizeKeyName('F1')).toBe('f1');
    expect(normalizeKeyName('AudioVolumeUp')).toBe('audiovolumeup');
    expect(normalizeKeyName('a')).toBe('a');
    expect(normalizeKeyName('A')).toBe('A');
    expect(normalizeKeyName('G')).toBe('G');
  });
});

describe('chordOf', () => {
  it('encodes Shift in printable characters rather than as a modifier', () => {
    expect(chordOf({ key: 'G', shiftKey: true })).toBe('G');
    expect(chordOf({ key: 'g' })).toBe('g');
  });

  it('adds the shift modifier for named keys', () => {
    expect(chordOf({ key: 'ArrowDown', shiftKey: true })).toBe('shift+down');
    expect(chordOf({ key: 'ArrowDown' })).toBe('down');
    expect(chordOf({ key: 'Tab', shiftKey: true })).toBe('shift+tab');
  });

  it('never adds shift for space (it would collide with the plain key)', () => {
    expect(chordOf({ key: ' ', shiftKey: true })).toBe('space');
  });

  it('emits modifiers in meta, ctrl, alt, shift order', () => {
    expect(chordOf({ key: 'k', metaKey: true, ctrlKey: true, altKey: true })).toBe(
      'meta+ctrl+alt+k',
    );
    expect(chordOf({ key: 'd', ctrlKey: true })).toBe('ctrl+d');
    expect(chordOf({ key: 'Enter', ctrlKey: true, altKey: true })).toBe('ctrl+alt+enter');
  });

  it('normalises the key name as part of the chord', () => {
    expect(chordOf({ key: 'Escape' })).toBe('escape');
    expect(chordOf({ key: ' ' })).toBe('space');
    expect(chordOf({ key: 'ArrowUp' })).toBe('up');
  });
});

describe('parseSequence', () => {
  it('splits on whitespace and drops empty parts', () => {
    expect(parseSequence('g g')).toEqual(['g', 'g']);
    expect(parseSequence('  g   g  ')).toEqual(['g', 'g']);
    expect(parseSequence('')).toEqual([]);
    expect(parseSequence('ctrl+w x')).toEqual(['ctrl+w', 'x']);
  });

  it('normalises every chord part', () => {
    expect(parseSequence('ArrowDown')).toEqual(['down']);
    expect(parseSequence('Escape')).toEqual(['escape']);
  });
});

describe('normalizeChordPart', () => {
  it('lower-cases modifiers and reorders them canonically', () => {
    // With a modifier present a single printable character is lower-cased, so
    // the written form matches what chordOf() produces for that keypress.
    expect(normalizeChordPart('Ctrl+D')).toBe('ctrl+d');
    expect(normalizeChordPart('CTRL+ALT+x')).toBe('ctrl+alt+x');
    expect(normalizeChordPart('shift+ArrowUp')).toBe('shift+up');
    expect(normalizeChordPart('META+CTRL+a')).toBe('meta+ctrl+a');
  });

  it('normalises named keys but preserves single printable characters', () => {
    expect(normalizeChordPart('Escape')).toBe('escape');
    expect(normalizeChordPart('G')).toBe('G');
    expect(normalizeChordPart('down')).toBe('down');
  });

  it('collapses Ctrl+D and Ctrl+Shift+D onto the same binding', () => {
    // Shift state is not reliably reported for printable keys while a modifier
    // is held, so one written binding must match either keypress.
    expect(normalizeChordPart('ctrl+d')).toBe('ctrl+d');
    expect(chordOf({ key: 'D', ctrlKey: true, shiftKey: true })).toBe('ctrl+d');
    expect(chordOf({ key: 'd', ctrlKey: true })).toBe('ctrl+d');
  });
});

describe('formatChord', () => {
  it('renders the human-readable forms used by the hint bar', () => {
    expect(formatChord('escape')).toBe('esc');
    expect(formatChord('space')).toBe('␣');
    expect(formatChord('ctrl+d')).toBe('^d');
    expect(formatChord('meta+d')).toBe('⌘d');
    expect(formatChord('shift+down')).toBe('⇧down');
    expect(formatChord('G')).toBe('G');
    expect(formatChord('g g')).toBe('g g');
  });
});

describe('isSequencePrefix', () => {
  it('accepts a true prefix and equality', () => {
    expect(isSequencePrefix('g', 'g g')).toBe(true);
    expect(isSequencePrefix('g g', 'g g')).toBe(true);
    expect(isSequencePrefix('ctrl+d', 'ctrl+d')).toBe(true);
  });

  it('rejects a diverging or longer sequence', () => {
    expect(isSequencePrefix('g h', 'g g')).toBe(false);
    expect(isSequencePrefix('g g g', 'g g')).toBe(false);
  });
});

describe('sequenceLength', () => {
  it('counts the chord tokens', () => {
    expect(sequenceLength('g g')).toBe(2);
    expect(sequenceLength('g')).toBe(1);
    expect(sequenceLength('')).toBe(0);
    expect(sequenceLength('ctrl+w x')).toBe(2);
  });
});

describe('chordOf / parseSequence agreement', () => {
  it('a binding written as a spec matches the chord of the real event', () => {
    const events: KeyEventLike[] = [
      { key: 'j' },
      { key: 'ArrowDown' },
      { key: 'G', shiftKey: true },
      { key: 'd', ctrlKey: true },
      { key: 'Escape' },
    ];
    const specs = ['j', 'down', 'G', 'ctrl+d', 'escape'];
    events.forEach((event, index) => {
      expect(chordOf(event)).toBe(parseSequence(specs[index]!).join(' '));
    });
  });
});
