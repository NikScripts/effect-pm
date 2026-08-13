/**
 * @module examples/last/context-link/Demo
 *
 * **Last.context + Last.link** — View kits in a nested context, composition via
 * `Last.use`, narrowed links (`params` props + `query`), external `out`.
 */
import { Layer, pipe } from "effect";
import * as React from "react";
import * as Last from "last-ts/Last";
import * as Layout from "last-ts/Layout";
import * as Memory from "last-ts/Memory";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";
import * as View from "last-ts/View";

// ---cut---
// =============================================================================
// Catalog (non-topLevel groups — ids match RouterBuilder.group)
// =============================================================================

export class Catalog extends Router.make("examples/last/context-link").add(
  Router.group("main").add(
    Route.get("home", "/"),
    Route.get("about", "/about"),
  ),
  Router.group("docs").add(
    Route.get("index", "/docs"),
    Route.get("chapter", "/docs/:slug"),
  ),
) {}

// =============================================================================
// Leaf Views (DOM)
// =============================================================================

export class Root extends View.make<Root, {
  readonly children?: React.ReactNode;
}>()(
  "examples/last/context-link/NavBar/Root",
  (props) => (
    <header data-nav="root">{props.children}</header>
  ),
) {}

export class Brand extends View.make<Brand, {
  readonly children?: React.ReactNode;
}>()(
  "examples/last/context-link/NavBar/Brand",
  (props) => <span data-nav="brand">{props.children}</span>,
) {}

/** Home — direct link (no `to` prop on the result). */
export const HomeBrand = Last.link(Catalog, Brand, {
  to: (u) => u.main.home(),
});

/** Docs chapter — uncalled route ⇒ `slug` (+ optional `query`) are props. */
export const ChapterLink = Last.link(Catalog, {
  to: (u) => u.docs.chapter,
});

/** Docs group — `to` picks only docs routes. */
export const DocsLink = Last.link(Catalog, {
  to: (u) => u.docs,
});

/** External. */
export const EffectLink = Last.link(Catalog, {
  out: "https://effect.website",
});

// =============================================================================
// Composition View + contexts
// =============================================================================

export class NavBar extends View.make<NavBar>()(
  "examples/last/context-link/NavBar",
  () => {
    const { Root: NavRoot } = Last.use(NavBarContext);
    return (
      <NavRoot>
        <HomeBrand>last.ts</HomeBrand>
        {" · "}
        <DocsLink
          to={(docs: { readonly index: () => string }) => docs.index()}
        >
          Docs
        </DocsLink>
        {" · "}
        <ChapterLink slug="routing">Routing</ChapterLink>
        {" · "}
        <ChapterLink slug="routing" query={{ tab: "api" }}>
          Routing?tab=api
        </ChapterLink>
        {" · "}
        <EffectLink>Effect</EffectLink>
      </NavRoot>
    );
  },
) {}

export class NavBarContext extends Last.context({
  Root,
  Brand,
  View: NavBar,
}) {}

export class Site extends Last.context({
  NavBar: NavBarContext,
}) {}

// =============================================================================
// Tree + provider
// =============================================================================

export const Tree = (): React.ReactElement => {
  const { NavBar: nav } = Last.use(Site);
  const Nav = nav.View;
  return <Nav />;
};

const main = pipe(
  RouterBuilder.group(Catalog, "main", (h) =>
    h
      .handle("home", () => <span>home</span>)
      .handle("about", () => <span>about</span>),
  ),
  Layout.provide(Layout.Passthrough),
);

const docs = pipe(
  RouterBuilder.group(Catalog, "docs", (h) =>
    h
      .handle("index", () => <span>docs</span>)
      .handle("chapter", () => <span>chapter</span>),
  ),
  Layout.provide(Layout.Passthrough),
);

const routes = pipe(
  RouterBuilder.layer(Catalog),
  Layer.provide(Layer.mergeAll(main, docs)),
);

/** Layer + Site context in one provider. */
export const Provider = Last.provider(
  pipe(Memory.layer, Layer.provide(routes)),
  Site,
);

export const App = (): React.ReactElement => (
  <Provider>
    <Tree />
  </Provider>
);
