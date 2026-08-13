/**
 * Last.use bag typing — Context.Service shapes (not unknown) + View slots.
 */
import { expectTypeOf } from "vitest";
import { Context } from "effect";
import type * as React from "react";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

class Brand extends View.make<Brand, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/test/last-context-use.test-d/Brand",
  () => null,
) {}

class Copy extends Context.Service<Copy, {
  readonly brand: string;
}>()("hyperlink-ts/test/last-context-use.test-d/Copy") {}

class NavBarContext extends Last.context({
  Brand,
  Copy,
}) {}

function read() {
  return Last.use(NavBarContext);
}

expectTypeOf(read().Copy.brand).toEqualTypeOf<string>();
expectTypeOf(read().Brand).toMatchTypeOf<
  (props: { readonly children?: React.ReactNode }) => React.ReactElement | null
>();

// @ts-expect-error Copy.brand is string, not number
const _bad: number = read().Copy.brand;
