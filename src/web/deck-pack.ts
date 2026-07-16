/**
 * @module web/deck-pack
 *
 * Pure layout math for the {@link Deck} auto-paginator — no React, no DOM. Lives on its own so the
 * packing algorithm (the trickiest part of the fullscreen detail pages) is unit-testable in plain
 * vitest without a jsdom render.
 */

/** px between sections — matches the `gap-3` the Deck renders. @internal */
export const DECK_GAP = 12;
/** Default packing height for a `grow` section (the height it claims before stretching). @internal */
export const DECK_GROW_MIN = 160;
/** px reserved for the dot gutter — kept constant so packing doesn't oscillate as pages appear. @internal */
export const DECK_DOTS = 20;

/** The minimal section shape the packer needs (the full `DeckSection` is a superset). @internal */
export interface Packable {
  readonly grow?: boolean;
  readonly minHeight?: number;
}

/**
 * The height a section claims when packing: a **grow** section by its `minHeight` (default
 * {@link DECK_GROW_MIN}) — its content is never measured, it stretches past this — a **fixed**
 * section by its `measured` natural height. @internal
 */
export const packingHeight = (section: Packable, measured: number): number =>
  section.grow === true ? section.minHeight ?? DECK_GROW_MIN : measured;

/**
 * Greedily pack section heights into pages that each fit `avail`, returning groups of indices. A
 * section that won't fit the current page starts the next one; a section taller than a whole page
 * still gets its own page (it scrolls within). Empty input yields a single empty page. @internal
 */
export const packSections = (
  heights: ReadonlyArray<number>,
  avail: number,
): ReadonlyArray<ReadonlyArray<number>> => {
  const pages: Array<Array<number>> = [];
  let cur: Array<number> = [];
  let used = 0;
  heights.forEach((h, i) => {
    const next = cur.length === 0 ? h : used + DECK_GAP + h;
    if (cur.length > 0 && next > avail) {
      pages.push(cur);
      cur = [i];
      used = h;
    } else {
      cur.push(i);
      used = next;
    }
  });
  if (cur.length > 0) pages.push(cur);
  return pages.length > 0 ? pages : [[]];
};
