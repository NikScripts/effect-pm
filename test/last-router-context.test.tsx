/**
 * Track 2 — router-scoped Last.context / Last.contextProvide / Last.use(App).
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, pipe } from "effect";
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
  "test/last-router-context/Brand",
  (props) => React.createElement("span", { "data-brand": "1" }, props.children),
) {}

class SiteCopy extends Context.Service<SiteCopy, {
  readonly brand: string;
}>()("test/last-router-context/SiteCopy") {}

class Site extends Last.context({
  Brand,
  SiteCopy,
}) {}

class DocsCopy extends Context.Service<DocsCopy, {
  readonly sidebarTitle: string;
}>()("test/last-router-context/DocsCopy") {}

class DocsKit extends Last.context({
  DocsCopy,
}) {}

class App extends Router.make("last-router-context-test")
  .context(Site)
  .add(
    Router.group("main").add(Route.get("home", "/")),
    Router.group("docs")
      .context(DocsKit)
      .add(Route.get("index", "/docs")),
  ) {}

const AppTree = (): React.ReactElement => {
  const { Brand: BrandView, SiteCopy: copy } = Last.use(App);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(BrandView, null, copy.brand),
    React.createElement(Layout.Outlet),
  );
};

const DocsTree = (): React.ReactElement => {
  const { Brand: BrandView, SiteCopy: copy } = Last.use(App);
  const docs = Last.use(App, "docs");
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(BrandView, null, copy.brand),
    React.createElement(
      "aside",
      { "data-docs": "1" },
      docs.DocsCopy.sidebarTitle,
    ),
    React.createElement(Layout.Outlet),
  );
};

class AppLayout extends Layout.make()(
  "test/last-router-context/AppLayout",
  Effect.sync(() => React.createElement(AppTree)),
) {}

class DocsLayout extends Layout.make()(
  "test/last-router-context/DocsLayout",
  Effect.sync(() => React.createElement(DocsTree)),
) {}

const main = pipe(
  RouterBuilder.group(App, "main", (h) =>
    h.handle("home", () =>
      React.createElement("p", { "data-page": "home" }, "home"),
    ),
  ),
  Layout.provide(AppLayout),
);

const docs = pipe(
  RouterBuilder.group(App, "docs", (h) =>
    h.handle("index", () =>
      React.createElement("p", { "data-page": "docs" }, "docs"),
    ),
  ),
  Layout.provide(DocsLayout),
  Last.contextProvide(
    DocsKit,
    Layer.succeed(DocsCopy, { sidebarTitle: "Guides" }),
  ),
);

const routes = pipe(
  RouterBuilder.layer(App),
  Layer.provideMerge(Layer.mergeAll(main, docs)),
  Last.contextProvide(Site, Layer.succeed(SiteCopy, { brand: "last.ts" })),
);

const Provider = Last.provider(
  pipe(Memory.layer, Layer.provideMerge(routes)),
);

/** Memory starts at `/`; sync `go` before Outlet so SSR sees the target path. */
const At = (props: {
  readonly path: string;
}): React.ReactElement => {
  const router = Router.useRouter();
  if (router.pathname !== props.path) {
    router.go(props.path, { replace: true });
  }
  return React.createElement(Router.Outlet);
};

describe("Last.contextProvide + Last.use(App)", () => {
  it("mounts root Site on / and renders from Last.use(App)", () => {
    const html = renderToString(
      React.createElement(
        Provider,
        null,
        React.createElement(At, { path: "/" }),
      ),
    );
    expect(html).toContain("data-brand");
    expect(html).toContain("last.ts");
    expect(html).toContain("data-page=\"home\"");
    expect(html).not.toContain("data-docs");
  });

  it("mounts docs kit on /docs via Last.use(App, \"docs\")", () => {
    const html = renderToString(
      React.createElement(
        Provider,
        null,
        React.createElement(At, { path: "/docs" }),
      ),
    );
    expect(html).toContain("data-brand");
    expect(html).toContain("data-docs");
    expect(html).toContain("Guides");
    expect(html).toContain("data-page=\"docs\"");
  });
});
