/**
 * Layer + components for the typed-JSX docs island.
 * Runtime mirror of the Twoslash tree (createElement — no last-ts jsx on client).
 */
import * as React from "react";
import { Atom } from "effect/unstable/reactivity";
import { Context, Layer } from "effect";
import * as View from "last-ts/View";

class Greeter extends Context.Service<Greeter, string>()(
  "docs/site/view-typed-jsx/Greeter",
) {}

export const Inner = View.gen(function* () {
  const name = yield* Greeter;
  return (_props: {}) =>
    React.createElement("span", { "data-demo": "inner" }, `hello ${name}`);
});

export const Middle = View.succeed((_props: {}) =>
  React.createElement(
    "aside",
    { "data-demo": "middle" },
    React.createElement(Inner, {}),
  ),
);

export const Outer = View.succeed((_props: {}) =>
  React.createElement(
    "div",
    { "data-demo": "outer" },
    React.createElement(
      "section",
      null,
      React.createElement("article", null, React.createElement(Middle, {})),
    ),
  ),
);

export const demoLayer = Layer.succeed(Greeter, "nik");
export const demoRuntime = Atom.runtime(demoLayer);
