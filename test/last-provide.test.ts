/**
 * yield* Last.provide → Last.toLayer(Service, gen) → View.mount
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
>()("hyperlink-ts/test/last-provide.test/ShellMeta") {}

class ModalMeta extends Context.Service<
  ModalMeta,
  { readonly title: string }
>()("hyperlink-ts/test/last-provide.test/ModalMeta") {}

function* helloProvides() {
  yield* Last.provide(ShellMeta, { title: "uDumb" });
}

class Page extends View.make<Page>()("test/last-provide/Page") {
  static layer = Layer.effect(
    Page,
    Effect.gen(function* () {
      const meta = yield* ShellMeta;
      return (_props: {}) =>
        React.createElement(
          "div",
          null,
          React.createElement("h1", null, meta.title),
          React.createElement("p", null, "body"),
        );
    }),
  ).pipe(Layer.provide(Last.toLayer(ShellMeta, helloProvides)));
}

describe("yield* Last.provide → Context.Service → View", () => {
  it("deep provide + toLayer supplies yield* in another View", () => {
    const App = View.mount(Page);
    const html = renderToString(React.createElement(App));
    expect(html).toContain("uDumb");
    expect(html).toContain("body");
  });

  it("last write wins across provide calls", () => {
    function* winsProvides() {
      yield* Last.provide(ShellMeta, { title: "first" });
      yield* Last.provide(ShellMeta, { title: "second" });
    }

    class Show extends View.make<Show>()("test/last-provide/Show") {
      static layer = Layer.effect(
        Show,
        Effect.gen(function* () {
          const meta = yield* ShellMeta;
          return (_props: {}) => React.createElement("span", null, meta.title);
        }),
      ).pipe(Layer.provide(Last.toLayer(ShellMeta, winsProvides)));
    }

    const App = View.mount(Show);
    expect(renderToString(React.createElement(App))).toContain("second");
  });

  it("two services keep separate titles", () => {
    function* metaProvides() {
      yield* Last.provide(ShellMeta, { title: "Shell" });
      yield* Last.provide(ModalMeta, { title: "Modal" });
    }

    class Both extends View.make<Both>()("test/last-provide/Both") {
      static layer = Layer.effect(
        Both,
        Effect.gen(function* () {
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
      ).pipe(
        Layer.provide(
          Layer.mergeAll(
            Last.toLayer(ShellMeta, metaProvides),
            Last.toLayer(ModalMeta, metaProvides),
          ),
        ),
      );
    }

    const App = View.mount(Both);
    const html = renderToString(React.createElement(App));
    expect(html).toContain("Shell");
    expect(html).toContain("Modal");
  });
});
