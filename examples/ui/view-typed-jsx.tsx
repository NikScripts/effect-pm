/**
 * Typed JSX demo — Greeter bubbles Inner → Middle → Outer.
 *
 * Docs (Tailscale): http://100.67.32.32:5190/docs/view-typed-jsx
 *
 * TypeScript types `<Foo />` as a black-box `JSX.Element`. The typed channel is
 * `jsx` / `jsxs` from `last-ts/jsx-runtime` (same runtime as the JSX transform).
 */
/** @jsxImportSource last-ts */
import { Context } from "effect";
import { jsx, jsxs } from "last-ts/jsx-runtime";
import * as View from "last-ts/View";

export class Greeter extends Context.Service<Greeter, string>()(
  "examples/ui/view-typed-jsx/Greeter",
) {}

// ---cut---
/** Needs Greeter (`yield*`). */
export const Inner = View.gen(function* () {
  const name = yield* Greeter;
  return (_props: {}) => <span data-demo="inner">hello {name}</span>;
});

Inner;
// ^?

/** No yield* — nests Inner via typed `jsx`. */
export const Middle = View.succeed((_props: {}) =>
  jsx("aside", {
    "data-demo": "middle",
    children: jsx(Inner, {}),
  }),
);

Middle;
// ^?

/** No yield* — nests Middle (which nests Inner). */
export const Outer = View.succeed((_props: {}) =>
  jsxs("div", {
    "data-demo": "outer",
    children: jsx("section", {
      children: jsx("article", {
        children: jsx(Middle, {}),
      }),
    }),
  }),
);

Outer;
// ^?
