/**
 * Fitting a single-line row to its box.
 *
 * The hint bar cannot scroll, and it must not clip an entry in the middle of a
 * label — `[q] back / clos` reads like a broken key rather than a full row — so
 * the entries that do not fit are dropped whole. That is arithmetic, so it lives
 * here and is tested without a browser.
 */

export interface FitItem {
  /** Natural width of the entry, in px. */
  width: number;
  /**
   * Never dropped: this is the key that reveals everything the row could not
   * show, so dropping it would hide the only way to find the rest.
   */
  pinned?: boolean;
}

/**
 * The indexes to render, in the order to render them.
 *
 * Unpinned entries are kept as a prefix, so the row reads as the start of the
 * list rather than an arbitrary selection of whatever happened to be short
 * enough. Pinned entries are appended last, so a row that ran out of room still
 * ends with the way out.
 *
 * `available <= 0` means the layout is not known yet (the first paint, or jsdom
 * where every measured width is 0) and returns everything rather than blanking
 * the row.
 */
export function fittedIndexes(items: FitItem[], available: number, gap: number): number[] {
  if (available <= 0 || items.length === 0) return items.map((_, index) => index);

  const widthOf = (indexes: number[]): number =>
    indexes.reduce(
      (total, index, position) => total + (items[index]?.width ?? 0) + (position > 0 ? gap : 0),
      0,
    );

  const pinned = items.flatMap((item, index) => (item.pinned === true ? [index] : []));
  const rest: number[] = [];

  // The pinned entries' width is reserved before anything else: they are not
  // negotiable, and the prefix is measured against what is left of the row. If
  // they alone overrun the box, `used` starts above `available`, the loop takes
  // nothing, and they are still what gets shown.
  let used = widthOf(pinned);
  for (let index = 0; index < items.length; index += 1) {
    if (pinned.includes(index)) continue;
    const next = used + (items[index]?.width ?? 0) + (pinned.length + rest.length > 0 ? gap : 0);
    if (next > available) break;
    used = next;
    rest.push(index);
  }

  return [...rest, ...pinned];
}
