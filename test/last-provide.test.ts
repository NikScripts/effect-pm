/**
 * Last.provided → toLayer → View.mount — Context.Service value bags.
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

class ShellMeta extends Context.Service<
  ShellMeta,
  { readonly title: string }
>()("test/last-provide-runtime/ShellMeta") {}

class ModalMeta extends Context.Service<
  ModalMeta,
  { readonly title: string }
>()("test/last-provide-runtime/ModalMeta") {}

describe("Last.provided → Context.Service → View", () => {
  it("toLayer supplies yield* service inside View.gen", () => {
    const Shell = View.gen(function* () {
      const meta = yield* ShellMeta;
      return (_props: {}) => React.createElement("h1", null, meta.title);
    });

    const App = View.mount(
      Shell,
      Last.toLayer(Last.provided(ShellMeta, { title: "uDumb" })),
    );

    expect(renderToString(React.createElement(App))).toContain("uDumb");
  });

  it("merge last-wins before toLayer", () => {
    const ledger = Last.merge(Last.provided(ShellMeta, { title: "first" }), {
      title: "second",
    });
    expect(ledger.bag.title).toBe("second");

    const Shell = View.gen(function* () {
      const meta = yield* ShellMeta;
      return (_props: {}) => React.createElement("span", null, meta.title);
    });
    const App = View.mount(Shell, Last.toLayer(ledger));
    expect(renderToString(React.createElement(App))).toContain("second");
  });

  it("two services keep separate titles", () => {
    const Both = View.gen(function* () {
      const shell = yield* ShellMeta;
      const modal = yield* ModalMeta;
      return (_props: {}) =>
        React.createElement(
          "div",
          null,
          React.createElement("span", { "data-shell": true }, shell.title),
          React.createElement("span", { "data-modal": true }, modal.title),
        );
    });

    const App = View.mount(
      Both,
      Layer.mergeAll(
        Last.toLayer(ShellMeta, { title: "Shell" }),
        Last.toLayer(ModalMeta, { title: "Modal" }),
      ),
    );

    const html = renderToString(React.createElement(App));
    expect(html).toContain("Shell");
    expect(html).toContain("Modal");
  });

  it("provide Effect builds Provided for toLayer", async () => {
    const ledger = await Effect.runPromise(
      Last.provide(ShellMeta, { title: "from-effect" }),
    );
    const layer = Last.toLayer(ledger);
    const program = Effect.gen(function* () {
      const meta = yield* ShellMeta;
      return meta.title;
    }).pipe(Effect.provide(layer));
    expect(await Effect.runPromise(program)).toBe("from-effect");
  });
});
