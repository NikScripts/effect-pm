/**
 * Last.context / Last.use / Last.link + Router.Link `out`.
 */
import { describe, expect, it } from "@effect/vitest";
import { Layer, pipe } from "effect";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as Last from "last-ts/Last";
import * as Layout from "last-ts/Layout";
import * as Memory from "last-ts/Memory";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";
import * as View from "last-ts/View";

class Brand extends View.make<Brand, { readonly children?: React.ReactNode }>()(
  "test/last-context/Brand",
  (props) => React.createElement("span", { "data-brand": "1" }, props.children),
) {}

class NavBar extends View.make<NavBar>()("test/last-context/NavBar", () => {
  const { Brand: BrandView } = Last.use(NavBarContext);
  return React.createElement(BrandView, null, "last.ts");
}) {}

class NavBarContext extends Last.context({
  Brand,
  View: NavBar,
}) {}

class Site extends Last.context({
  NavBar: NavBarContext,
}) {}

class Catalog extends Router.make("last-context-link").add(
  Router.group("main", { topLevel: true }).add(
    Route.get("home", "/"),
    Route.get("about", "/about"),
  ),
  Router.group("docs").add(
    Route.get("index", "/docs"),
    Route.get("chapter", "/docs/:slug"),
  ),
) {}

const main = pipe(
  RouterBuilder.group(Catalog, "main", (h) =>
    h
      .handle("home", () => React.createElement("span", null, "home"))
      .handle("about", () => React.createElement("span", null, "about")),
  ),
  Layout.provide(Layout.Passthrough),
);

const docs = pipe(
  RouterBuilder.group(Catalog, "docs", (h) =>
    h
      .handle("index", () => React.createElement("span", null, "docs"))
      .handle("chapter", () => React.createElement("span", null, "chapter")),
  ),
  Layout.provide(Layout.Passthrough),
);

const routes = pipe(
  RouterBuilder.layer(Catalog),
  Layer.provide(Layer.mergeAll(main, docs)),
);

const routerLayer = pipe(Memory.layer, Layer.provide(routes));

describe("Last.context / Last.use", () => {
  it("provider(layer, Site) exposes nested bags to Last.use", () => {
    const Provider = Last.provider(Layer.empty, Site);

    const Tree = (): React.ReactElement => {
      const { NavBar: nav } = Last.use(Site);
      const Nav = nav.View;
      return React.createElement(Nav);
    };

    const html = renderToString(
      React.createElement(Provider, null, React.createElement(Tree)),
    );
    expect(html).toContain("data-brand");
    expect(html).toContain("last.ts");
  });

  it("Last.use(NavBarContext) works under Site provider", () => {
    const Provider = Last.provider(Layer.empty, Site);

    const Tree = (): React.ReactElement => {
      const { Brand: BrandView } = Last.use(NavBarContext);
      return React.createElement(BrandView, null, "x");
    };

    const html = renderToString(
      React.createElement(Provider, null, React.createElement(Tree)),
    );
    expect(html).toContain("data-brand");
    expect(html).toContain("x");
  });
});

describe("Last.link + Link out", () => {
  const Provider = Last.provider(routerLayer);

  it("direct link and out", () => {
    const HomeLink = Last.link(Catalog, { to: (u) => u.home() });
    const ExtLink = Last.link(Catalog, { out: "https://effect.website" });

    const Tree = (): React.ReactElement =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(HomeLink, null, "Home"),
        React.createElement(ExtLink, null, "Effect"),
      );

    const html = renderToString(
      React.createElement(Provider, null, React.createElement(Tree)),
    );
    expect(html).toContain('href="/"');
    expect(html).toContain("Home");
    expect(html).toContain('href="https://effect.website"');
    expect(html).toContain("noopener");
  });

  it("uncalled route → params props + query prop", () => {
    const ChapterLink = Last.link(Catalog, {
      to: (u) => u.docs.chapter,
    });

    const Tree = (): React.ReactElement =>
      React.createElement(
        ChapterLink,
        { slug: "routing", query: { tab: "api" } },
        "Routing",
      );

    const html = renderToString(
      React.createElement(Provider, null, React.createElement(Tree)),
    );
    expect(html).toContain('href="/docs/routing?tab=api"');
    expect(html).toContain("Routing");
  });

  it("group-narrowed DocsLink", () => {
    const DocsLink = Last.link(Catalog, { to: (u) => u.docs });

    const Tree = (): React.ReactElement =>
      React.createElement(
        DocsLink,
        {
          to: (d: { readonly chapter: (s: string) => string }) =>
            d.chapter("routing"),
        },
        "Routing",
      );

    const html = renderToString(
      React.createElement(Provider, null, React.createElement(Tree)),
    );
    expect(html).toContain('href="/docs/routing"');
  });
});
