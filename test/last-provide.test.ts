/**
 * yield* Last.provide → Last.toLayer(Service, viewLayer) → View.mount
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
>()("hyperlink-ts/test/last-provide.test/ShellMeta") {}

class ModalMeta extends Context.Service<
  ModalMeta,
  { readonly title: string }
>()("hyperlink-ts/test/last-provide.test/ModalMeta") {}

class Hello extends View.Service<Hello>()("test/last-provide/Hello") {
  static layer = View.gen(Hello, function* () {
    yield* Last.provide(ShellMeta, { title: "uDumb" });
    return (_props: {}) => React.createElement("p", null, "body");
  });
}

class Page extends View.Service<Page>()("test/last-provide/Page") {
  static layer = View.gen(Page, function* () {
    const meta = yield* ShellMeta;
    return (_props: {}) =>
      React.createElement(
        "div",
        null,
        React.createElement("h1", null, meta.title),
        React.createElement("p", null, "body"),
      );
  });
}

describe("yield* Last.provide → Context.Service → View", () => {
  it("deep provide + toLayer supplies yield* in another View", () => {
    const App = View.mount(
      Page,
      Page.layer.pipe(Layer.provide(Last.toLayer(ShellMeta, Hello.layer))),
    );

    const html = renderToString(React.createElement(App));
    expect(html).toContain("uDumb");
    expect(html).toContain("body");
  });

  it("last write wins across provide calls", () => {
    class Wins extends View.Service<Wins>()("test/last-provide/Wins") {
      static layer = View.gen(Wins, function* () {
        yield* Last.provide(ShellMeta, { title: "first" });
        yield* Last.provide(ShellMeta, { title: "second" });
        return (_props: {}) => null;
      });
    }

    class Show extends View.Service<Show>()("test/last-provide/Show") {
      static layer = View.gen(Show, function* () {
        const meta = yield* ShellMeta;
        return (_props: {}) => React.createElement("span", null, meta.title);
      });
    }

    const App = View.mount(
      Show,
      Show.layer.pipe(Layer.provide(Last.toLayer(ShellMeta, Wins.layer))),
    );
    expect(renderToString(React.createElement(App))).toContain("second");
  });

  it("two services keep separate titles", () => {
    class Meta extends View.Service<Meta>()("test/last-provide/Meta") {
      static layer = View.gen(Meta, function* () {
        yield* Last.provide(ShellMeta, { title: "Shell" });
        yield* Last.provide(ModalMeta, { title: "Modal" });
        return (_props: {}) => null;
      });
    }

    class Both extends View.Service<Both>()("test/last-provide/Both") {
      static layer = View.gen(Both, function* () {
        const shell = yield* ShellMeta;
        const modal = yield* ModalMeta;
        return (_props: {}) =>
          React.createElement(
            "div",
            null,
            React.createElement("span", null, shell.title),
            React.createElement("span", null, modal.title),
          );
      });
    }

    const App = View.mount(
      Both,
      Both.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Last.toLayer(ShellMeta, Meta.layer),
            Last.toLayer(ModalMeta, Meta.layer),
          ),
        ),
      ),
    );

    const html = renderToString(React.createElement(App));
    expect(html).toContain("Shell");
    expect(html).toContain("Modal");
  });
});
