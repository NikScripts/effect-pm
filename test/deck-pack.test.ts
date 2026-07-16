import { describe, expect, it } from "vitest";
import {
  DECK_GAP,
  DECK_GROW_MIN,
  packingHeight,
  packSections,
} from "../src/web/deck-pack";

describe("packSections", () => {
  it("keeps everything on one page when it fits (no split → no dots)", () => {
    // three 100px sections + 2 gaps = 324 ≤ 500
    expect(packSections([100, 100, 100], 500)).toEqual([[0, 1, 2]]);
  });

  it("starts a new page when the next section would overflow", () => {
    // 200 + gap + 200 = 412 > 400 → second section spills
    expect(packSections([200, 200], 400)).toEqual([[0], [1]]);
  });

  it("accounts for the inter-section gap in the fit check", () => {
    // two 195px sections: 195+195=390 fits, but with the 12px gap 402 > 400 → split
    expect(packSections([195, 195], 400)).toEqual([[0], [1]]);
    // shrink avail's competitor: 195+195+gap = 402 ≤ 402 → together
    expect(packSections([195, 195], 402)).toEqual([[0, 1]]);
  });

  it("gives a section taller than a whole page its own page (it scrolls within)", () => {
    expect(packSections([100, 900, 100], 400)).toEqual([[0], [1], [2]]);
  });

  it("packs a longer run into as many pages as needed", () => {
    // 150 each, avail 400: page fits 150+g+150=312, +g+150=474>400 → 2 per page
    expect(packSections([150, 150, 150, 150, 150], 400)).toEqual([
      [0, 1],
      [2, 3],
      [4],
    ]);
  });

  it("returns a single empty page for no sections", () => {
    expect(packSections([], 500)).toEqual([[]]);
  });

  it("never strands a leading section even when the first is oversized", () => {
    expect(packSections([900, 100], 400)).toEqual([[0], [1]]);
  });

  it("uses the real DECK_GAP constant (regression guard on the 12px assumption)", () => {
    // exactly at the boundary: 100 + DECK_GAP + 100 === avail → fits together
    expect(packSections([100, 100], 100 + DECK_GAP + 100)).toEqual([[0, 1]]);
    // one px tighter → split
    expect(packSections([100, 100], 100 + DECK_GAP + 100 - 1)).toEqual([[0], [1]]);
  });
});

describe("packingHeight", () => {
  it("measures a fixed section by its natural height", () => {
    expect(packingHeight({}, 137)).toBe(137);
    expect(packingHeight({ grow: false }, 137)).toBe(137);
  });

  it("packs a grow section by its minHeight, ignoring the measured value", () => {
    expect(packingHeight({ grow: true, minHeight: 220 }, 9999)).toBe(220);
  });

  it("falls back to DECK_GROW_MIN for a grow section with no minHeight", () => {
    expect(packingHeight({ grow: true }, 9999)).toBe(DECK_GROW_MIN);
  });
});
