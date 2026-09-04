import { describe, expect, it } from "@effect/vitest";
import * as Last from "../packages/last-ts/src/Last";
import * as Link from "../packages/last-ts/src/Link";
import * as View from "../packages/last-ts/src/View";

/**
 * Regression: View → Last → link → Link → View used to TDZ on `Last.kindSym`
 * while Link evaluated during Last’s init. Loading Last (and Link) must succeed.
 */
describe("Last.kindSym / View cycle", () => {
  it("loads Last + Link + View without TDZ", () => {
    class Greeter extends View.make<Greeter, { readonly name: string }>()(
      "app/test/kindSymCycle/Greeter",
      (_props) => null,
    ) {}
    expect(Last.kindOf(Greeter)).toBe(View.kind);
    expect(Last.kindSym in Greeter).toBe(true);
    expect(typeof Link.View).toBe("function");
  });
});
