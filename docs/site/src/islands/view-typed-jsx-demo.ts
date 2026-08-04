/**
 * Runtime mirror of the gen + mount Twoslash demo.
 */
import * as React from "react";
import * as View from "last-ts/View";

class Greeter extends View.Tag<Greeter, { readonly name: string }>()(
  "docs/site/view-typed-jsx/Greeter",
) {}

export const Hello = View.gen(function* () {
  const GreeterView = yield* Greeter;
  return (props: { readonly who: string }) =>
    React.createElement(GreeterView, { name: props.who });
});

/** Mounted app — JSX-legal (`R` discharged). */
export const App = View.mount(
  View.gen(function* () {
    const GreeterView = yield* Greeter;
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
            React.createElement(
              "aside",
              { "data-demo": "middle" },
              React.createElement(GreeterView, { name: "nik" }),
            ),
          ),
        ),
      );
  }),
  Greeter.provide((props) =>
    React.createElement("span", { "data-demo": "inner" }, `hello ${props.name}`),
  ),
);
