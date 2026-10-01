/**
 * Keyboard event normalisation.
 *
 * The vim convention is preserved: `G` and `g` are *different* chords, because
 * Shift is expressed by the character itself rather than as a modifier. Modifier
 * combinations are written in a canonical order (`ctrl+alt+shift+<key>`) so
 * bindings can be compared as plain strings.
 *
 * Multi-key sequences use a space separator: `'g g'`, `'g h'`, `'ctrl+w x'`.
 */

export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** Special keys, mapped to short stable names. */
const NAMED_KEYS: Record<string, string> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Escape: 'escape',
  Esc: 'escape',
  Enter: 'enter',
  ' ': 'space',
  Spacebar: 'space',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Insert: 'insert',
};

export function normalizeKeyName(key: string): string {
  const named = NAMED_KEYS[key];
  if (named) return named;
  // Named DOM keys arrive capitalised ("F1", "AudioVolumeUp"): lower-case them
  // so bindings do not have to guess, but keep printable characters as typed.
  if (key.length > 1) return key.toLowerCase();
  return key;
}

/** A single keypress, as a comparable chord token. */
export function chordOf(event: KeyEventLike): string {
  const parts: string[] = [];
  if (event.metaKey) parts.push('meta');
  if (event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  const key = normalizeKeyName(event.key);
  // Shift is only meaningful for named keys; printable keys already encode it.
  if (event.shiftKey && key.length > 1 && key !== 'space') parts.push('shift');
  return joinChord(parts, key);
}

/**
 * Join modifiers and a key into a canonical chord.
 *
 * With a modifier held, a single printable character is lower-cased: Ctrl+D and
 * Ctrl+Shift+D cannot be told apart reliably across layouts, so collapsing them
 * keeps one binding working everywhere instead of silently doing nothing.
 */
function joinChord(modifiers: string[], key: string): string {
  const normalizedKey = modifiers.length > 0 && key.length === 1 ? key.toLowerCase() : key;
  return [...modifiers, normalizedKey].join('+');
}

/** Split a binding's key spec ('g g', 'ctrl+d', 'G') into chord tokens. */
export function parseSequence(spec: string): string[] {
  return spec
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map(normalizeChordPart);
}

/** Normalise the written form so `'Ctrl+D'` and `'ctrl+d'` are the same binding. */
export function normalizeChordPart(part: string): string {
  const pieces = part.split('+');
  const key = pieces.pop() ?? '';
  const modifiers = pieces.map((modifier) => modifier.toLowerCase()).sort(byModifierOrder);
  return joinChord(modifiers, normalizeKeyName(key));
}

function byModifierOrder(a: string, b: string): number {
  const order = ['meta', 'ctrl', 'alt', 'shift'];
  return order.indexOf(a) - order.indexOf(b);
}

/** Human-readable rendering for the help overlay and hint bar: "g h". */
export function formatChord(spec: string): string {
  return parseSequence(spec)
    .map((chord) =>
      chord
        .replace('escape', 'esc')
        .replace('space', '␣')
        .replace('ctrl+', '^')
        .replace('meta+', '⌘')
        .replace('shift+', '⇧'),
    )
    .join(' ');
}

/** True when the spec is a prefix of (or equal to) another sequence. */
export function isSequencePrefix(prefix: string, spec: string): boolean {
  const prefixTokens = parseSequence(prefix);
  const tokens = parseSequence(spec);
  if (prefixTokens.length > tokens.length) return false;
  return prefixTokens.every((token, index) => token === tokens[index]);
}

export function sequenceLength(spec: string): number {
  return parseSequence(spec).length;
}
