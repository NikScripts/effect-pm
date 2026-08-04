/**
 * yield* Last.provide → Last.toLayer(Service, view) → View.mount
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Layer } from "effect";
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

describe("yield* Last.provide → Context.Service → View", () => {
  it("deep provide + toLayer supplies yield* in another View", () => {
    const Hello = View.gen(function* () {
      yield* Last.provide(ShellMeta, { title: "uDumb" });
      return (_props: {}) => React.createElement("p", null, "body");
    });

    const Shell = View.gen(function* () {
      const meta = yield* ShellMeta;
      return (_props: {}) =>
        React.createElement("header", null, React.createElement("h1", null, meta.title));
    });

    const App = View.mount(
      View.gen(function* () {
        const meta = yield* ShellMeta;
        return (_props: {}) =>
          React.createElement(
            "div",
            null,
            React.createElement("h1", null, meta.title),
            React.createElement("p", null, "body"),
          );
      }),
      Last.toLayer(ShellMeta, Hello),
    );

    const html = renderToString(React.createElement(App));
    expect(html).toContain("uDumb");
    expect(html).toContain("body");
    void Shell;
  });

  it("last write wins across provide calls", () => {
    const Hello = View.gen(function* () {
      yield* Last.provide(ShellMeta, { title: "first" });
      yield* Last.provide(ShellMeta, { title: "second" });
      return (_props: {}) => null;
    });

    const App = View.mount(
      View.gen(function* () {
        const meta = yield* ShellMeta;
        return (_props: {}) => React.createElement("span", null, meta.title);
      }),
      Last.toLayer(ShellMeta, Hello),
    );
    expect(renderToString(React.createElement(App))).toContain("second");
  });

  it("two services keep separate titles", () => {
    const Meta = View.gen(function* () {
      yield* Last.provide(ShellMeta, { title: "Shell" });
      yield* Last.provide(ModalMeta, { title: "Modal" });
      return (_props: {}) => null;
    });

    const App = View.mount(
      View.gen(function* () {
        const shell = yield* ShellMeta;
        const modal = yield* ModalMeta;
        return (_props: {}) =>
          React.createElement(
            "div",
            null,
            React.createElement("span", null, shell.title),
            React.createElement("span", null, modal.title),
          );
      }),
      Layer.mergeAll(
        Last.toLayer(ShellMeta, Meta),
        Last.toLayer(ModalMeta, Meta),
      ),
    );

    const html = renderToString(React.createElement(App));
    expect(html).toContain("Shell");
    expect(html).toContain("Modal");
  });
});
