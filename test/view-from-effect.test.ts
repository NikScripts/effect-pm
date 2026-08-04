/**
 * View.succeed / View.gen / View.effect — Layer constructors (Service-first).
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as View from "last-ts/View";

class Prefix extends Context.Service<Prefix, string>()(
  "hyperlink-ts/test/view-from-effect.test/Prefix",
) {}

describe("View.succeed / gen / effect → Layer → mount", () => {
  it("View.succeed(Service, impl) mounts via View.mount", () => {
    class Greeter extends View.Service<
      Greeter,
      { readonly name: string }
    >()("test/view-fx/Greeter") {
      static layer = View.succeed(Greeter, (props) =>
        React.createElement("h1", null, props.name),
      );
    }
    const App = View.mount(Greeter, Greeter.layer);
    expect(renderToString(React.createElement(App, { name: "nik" }))).toContain(
      "nik",
    );
  });

  it("View.gen yields services at layer build, then returns a component", () => {
    class Greeter extends View.Service<
      Greeter,
      { readonly name: string }
    >()("test/view-fx/GreeterGen") {
      static layer = View.gen(Greeter, function* () {
        const prefix = yield* Prefix;
        return (props: { readonly name: string }) =>
          React.createElement("h1", null, `${prefix}${props.name}`);
      });
    }
    const App = View.mount(
      Greeter,
      Greeter.layer.pipe(Layer.provide(Layer.succeed(Prefix, "hi "))),
    );
    const html = renderToString(React.createElement(App, { name: "nik" }));
    expect(html).toContain("hi nik");
  });

  it("View.effect is Layer.effect for a View Service", () => {
    class Greeter extends View.Service<
      Greeter,
      { readonly name: string }
    >()("test/view-fx/GreeterEffect") {
      static layer = View.effect(
        Greeter,
        Effect.succeed((props: { readonly name: string }) =>
          React.createElement("h1", null, props.name),
        ),
      );
    }
    const App = View.mount(Greeter, Greeter.layer);
    expect(renderToString(React.createElement(App, { name: "ok" }))).toContain(
      "ok",
    );
  });
});
