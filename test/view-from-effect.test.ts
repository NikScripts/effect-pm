/**
 * View.fromEffect / gen / succeed — plain Effect → component (no Tag).
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as AtomReact from "last-ts/AtomReact";
import * as View from "last-ts/View";

const renderWithRuntime = (
  node: React.ReactElement,
  layer: Layer.Layer<any, any, never> = Layer.empty,
): string => {
  const runtime = Atom.runtime(layer);
  return renderToString(
    React.createElement(
      AtomReact.RegistryProvider,
      null,
      React.createElement(AtomReact.RuntimeProvider, {
        runtime,
        children: node,
      }),
    ),
  );
};

describe("View.fromEffect", () => {
  it("renders Effect-built component under RuntimeProvider", () => {
    const greeterFx = Effect.succeed((props: { readonly name: string }) =>
      React.createElement("h1", null, props.name),
    );
    const Greeter = View.fromEffect(greeterFx);
    expect(renderWithRuntime(React.createElement(Greeter, { name: "nik" }))).toContain(
      "nik",
    );
  });

  it("throws without RuntimeProvider", () => {
    const Greeter = View.fromEffect(
      Effect.succeed((_props: {}) => React.createElement("span")),
    );
    expect(() =>
      renderToString(React.createElement(Greeter, {})),
    ).toThrow(/RuntimeProvider/);
  });
});

describe("View.gen / succeed", () => {
  it("View.succeed is fromEffect(Effect.succeed)", () => {
    const Greeter = View.succeed((props: { readonly name: string }) =>
      React.createElement("h1", null, props.name),
    );
    expect(renderWithRuntime(React.createElement(Greeter, { name: "ok" }))).toContain(
      "ok",
    );
  });

  it("View.gen yields services then returns a component", () => {
    class Prefix extends Context.Service<Prefix, string>()("test/Prefix") {}
    const Greeter = View.gen(function* () {
      const prefix = yield* Prefix;
      return (props: { readonly name: string }) =>
        React.createElement("h1", null, `${prefix}${props.name}`);
    });
    const html = renderWithRuntime(
      React.createElement(Greeter, { name: "nik" }),
      Layer.succeed(Prefix, "hi "),
    );
    expect(html).toContain("hi nik");
  });
});
