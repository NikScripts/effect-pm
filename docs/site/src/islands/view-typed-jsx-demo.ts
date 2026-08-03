/**
 * Layer + components for the typed-JSX docs island.
 * Kept separate from the Twoslash example (no `@jsxImportSource last-ts` here).
 */
import * as React from "react";
import { Atom } from "effect/unstable/reactivity";
import { Context, Layer } from "effect";
import * as View from "last-ts/View";

class Greeter extends Context.Service<Greeter, string>()(
  "docs/site/view-typed-jsx/Greeter",
) {}

/** Same shape as the Twoslash `Inner` — createElement so the client never loads last-ts/jsx-runtime. */
export const Inner = View.gen(function* () {
  const name = yield* Greeter;
  return (_props: {}) =>
    React.createElement("span", { "data-demo": "inner" }, `hello ${name}`);
});

/** Deep nest of Inner — mirrors Twoslash `Outer`. */
export const Outer = View.gen(function* () {
  return (_props: {}) =>
    React.createElement(
      "div",
      { "data-demo": "outer" },
      React.createElement(
        "section",
        null,
        React.createElement(
          "article",
          null,
          React.createElement("aside", null, React.createElement(Inner, {})),
        ),
      ),
    );
});

export const demoLayer = Layer.succeed(Greeter, "nik");
export const demoRuntime = Atom.runtime(demoLayer);
