/**
 * Runtime mirror of the Service + Layer + Last.provide Twoslash demo.
 */
import * as React from "react";
import { Effect, Layer } from "effect";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

class Greeter extends View.make<Greeter, { readonly name: string }>()(
  "docs/site/view-typed-jsx/Greeter",
) {
  static layer = Layer.succeed(Greeter, (props) =>
    React.createElement(
      "span",
      { "data-demo": "inner" },
      `hello ${props.name}`,
    ),
  );
}

class AppRoot extends View.make<AppRoot>()("docs/site/view-typed-jsx/App") {
  static layer = Layer.effect(
    AppRoot,
    Effect.gen(function* () {
      const GreeterView = yield* Greeter;
      return (_props: Record<string, never>) =>
        React.createElement(
          "div",
          { "data-demo": "outer" },
          React.createElement(
            "section",
            null,
            React.createElement(
              "article",
              null,
              React.createElement(
                "aside",
                { "data-demo": "middle" },
                React.createElement(GreeterView, { name: "nik" }),
              ),
            ),
          ),
        );
    }),
  ).pipe(Layer.provide(Greeter.layer));
}

/** Mounted app — JSX-legal. */
export const App = View.stamp(Last.provide(AppRoot));
