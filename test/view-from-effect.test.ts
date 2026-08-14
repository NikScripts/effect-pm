/**
 * Layer.succeed / Layer.effect + Last.provide(Service).
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

class Prefix extends Context.Service<Prefix, string>()(
  "hyperlink-ts/test/view-from-effect.test/Prefix",
) {}

describe("Layer + Last.provide", () => {
  it("Layer.succeed(Service, impl) fulfills via Last.provide(Service)", () => {
    class Greeter extends View.make<
      Greeter,
      { readonly name: string }
    >()("test/view-fx/Greeter") {
      static layer = Layer.succeed(Greeter, (props) =>
        React.createElement("h1", null, props.name),
      );
    }
    const App = View.stamp(Last.provide(Greeter));
    expect(renderToString(React.createElement(App, { name: "nik" }))).toContain(
      "nik",
    );
  });

  it("Layer.effect yields services at layer build", () => {
    class Greeter extends View.make<
      Greeter,
      { readonly name: string }
    >()("test/view-fx/GreeterGen") {
      static layer = Layer.effect(
        Greeter,
        Effect.gen(function* () {
          const prefix = yield* Prefix;
          return (props: { readonly name: string }) =>
            React.createElement("h1", null, `${prefix}${props.name}`);
        }),
      ).pipe(Layer.provide(Layer.succeed(Prefix, "hi ")));
    }
    const App = View.stamp(Last.provide(Greeter));
    const html = renderToString(React.createElement(App, { name: "nik" }));
    expect(html).toContain("hi nik");
  });
});
