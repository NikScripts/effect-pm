/**
 * View.fromEffect — plain Effect → component (no Tag); runtime via provider.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as AtomReact from "last-ts/AtomReact";
import * as View from "last-ts/View";

describe("View.fromEffect", () => {
  it("renders Effect-built component under RuntimeProvider", () => {
    const greeterFx = Effect.succeed((props: { readonly name: string }) =>
      React.createElement("h1", null, props.name),
    );
    const Greeter = View.fromEffect(greeterFx);
    const runtime = Atom.runtime(Layer.empty);
    const html = renderToString(
      React.createElement(
        AtomReact.RegistryProvider,
        null,
        React.createElement(AtomReact.RuntimeProvider, {
          runtime,
          children: React.createElement(Greeter, { name: "nik" }),
        }),
      ),
    );
    expect(html).toContain("nik");
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
