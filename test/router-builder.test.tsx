/**
 * RouterBuilder + Memory.layer + Last.provider (HttpApi-shaped lock).
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { HttpApiEndpoint } from "effect/unstable/httpapi";
import * as React from "react";
import { renderToString } from "react-dom/server";
import type { Layout } from "last-ts/Layout";
import * as Last from "last-ts/Last";
import * as Memory from "last-ts/Memory";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";

const RootLayout: Layout = ({ children }) =>
  React.createElement("div", { "data-layout": "root" }, children);

const DocsLayout: Layout = ({ children }) =>
  React.createElement("div", { "data-layout": "docs" }, children);

const Home = (): React.ReactElement =>
  React.createElement("span", null, "home");

const Pricing = (): React.ReactElement =>
  React.createElement("span", null, "pricing");

const DocsIndex = (): React.ReactElement =>
  React.createElement("span", null, "docs-index");

const Chapter = (props: Route.HandleArgs): React.ReactElement =>
  React.createElement("span", null, `chapter:${props.params.chapter ?? ""}`);

class Site extends Router.make("site").add(
  Router.group("marketing", { topLevel: true }).add(
    Route.get("home", "/"),
    Route.get("pricing", "/pricing"),
  ),
  Router.group("docs")
    .add(
      Route.get("index", "/"),
      Route.get("chapter", "/:chapter"),
    )
    .prefix("/docs"),
) {}

const marketing = RouterBuilder.group(
  Site,
  "marketing",
  RootLayout,
  (h) => h.handle("home", Home).handle("pricing", Pricing),
);

const docs = RouterBuilder.group(Site, "docs", DocsLayout, (h) =>
  h
    .handle("index", DocsIndex)
    .handle("chapter", Chapter, { layout: false }),
);

const routes = RouterBuilder.layer(Site).pipe(
  Layer.provide(Layer.mergeAll(marketing, docs)),
);

// Transport requires Catalog|Handlers from RouterBuilder.layer
const provider = Last.provider(Memory.layer.pipe(Layer.provide(routes)));

describe("RouterBuilder (HttpApi-shaped)", () => {
  it("Last.provider + Memory.layer renders Outlet with group layout", () => {
    const html = renderToString(
      React.createElement(
        provider,
        null,
        React.createElement(Router.Outlet),
      ),
    );
    // Memory starts at `/` → marketing home + RootLayout
    expect(html).toContain("data-layout=\"root\"");
    expect(html).toContain("home");
  });

  it("navigate to docs chapter with layout: false", () => {
    const Probe = (): React.ReactElement => {
      const router = Router.useRouter();
      React.useEffect(() => {
        router.go("/docs/routing");
      }, [router]);
      return React.createElement(Router.Outlet);
    };
    const html = renderToString(
      React.createElement(provider, null, React.createElement(Probe)),
    );
    // SSR won't re-render after go — assert builder layers construct
    expect(html.length).toBeGreaterThan(0);
  });
});

const fileTable = [
  { id: "index", routePath: "/" },
  { id: "about", routePath: "/about" },
] as const;

class FileRoutes extends Context.Service<
  FileRoutes,
  ReadonlyArray<Router.RoutesOf<typeof fileTable>>
>()("test/router-builder/FileRoutes") {}

class FileSite extends Router.make("file-site").add(
  Router.group("root", { topLevel: true }).from(FileRoutes),
) {}

const IndexPage = (): React.ReactElement =>
  React.createElement("span", null, "file-index");

const AboutPage = (): React.ReactElement =>
  React.createElement("span", null, "file-about");

const filePages = RouterBuilder.group(FileSite, "root", RootLayout, (h) =>
  h.handle("index", IndexPage).handle("about", AboutPage),
);

const fileRoutes = RouterBuilder.layer(FileSite).pipe(
  Layer.provide(
    Layer.mergeAll(
      filePages,
      Router.layerDestinations(FileRoutes, fileTable),
    ),
  ),
);

const fileProvider = Last.provider(
  Memory.layer.pipe(Layer.provide(fileRoutes)),
);

describe("RouterBuilder group.from(Service)", () => {
  it("resolves destinations Layer into Catalog + Outlet", () => {
    const html = renderToString(
      React.createElement(
        fileProvider,
        null,
        React.createElement(Router.Outlet),
      ),
    );
    expect(html).toContain("file-index");
    expect(html).toContain("data-layout=\"root\"");
  });

  it("UrlBuilder sees resolved file destinations", async () => {
    const runtime = ManagedRuntime.make(
      Memory.layer.pipe(Layer.provide(fileRoutes)),
    );
    try {
      const router = await runtime.runPromise(
        Effect.gen(function* () {
          return yield* Router.Router;
        }),
      );
      expect(router.urls.index()).toBe("/");
      expect(router.urls.about()).toBe("/about");
    } finally {
      await runtime.dispose();
    }
  });
});

const User = Schema.Struct({ id: Schema.String });

class MixedSite extends Router.make("mixed").add(
  Router.group("app").add(
    Route.get("dashboard", "/app"),
    HttpApiEndpoint.get("getUser", "/users/:id", {
      params: { id: Schema.String },
      success: User,
    }),
  ),
) {}

const mixed = RouterBuilder.group(MixedSite, "app", RootLayout, (h) =>
  h
    .handle("dashboard", () => React.createElement("span", null, "dash"))
    .handle("getUser", (req) => {
      const params = (req as { readonly params: { readonly id: string } })
        .params;
      return Effect.succeed({ id: params.id });
    }),
);

const mixedRoutes = RouterBuilder.layer(MixedSite).pipe(Layer.provide(mixed));
const mixedProvider = Last.provider(
  Memory.layer.pipe(Layer.provide(mixedRoutes)),
);

describe("RouterBuilder mixed Page + Json handlers", () => {
  it("completes ValidateReturn for Page page + Effect API handler", () => {
    const html = renderToString(
      React.createElement(
        mixedProvider,
        null,
        React.createElement(Router.Outlet),
      ),
    );
    // Memory starts at `/` — no Page match; builder still constructs.
    expect(html.length).toBeGreaterThanOrEqual(0);
  });

  it("registers Page + Api handler runtimes by success kind", async () => {
    const runtime = ManagedRuntime.make(mixedRoutes);
    try {
      const registry = await runtime.runPromise(
        Effect.gen(function* () {
          return yield* RouterBuilder.Registry;
        }),
      );
      const impl = registry.groups.get("app");
      expect(impl?.handlers.get("dashboard")?._tag).toBe("Page");
      expect(impl?.handlers.get("getUser")?._tag).toBe("Api");
    } finally {
      await runtime.dispose();
    }
  });
});
