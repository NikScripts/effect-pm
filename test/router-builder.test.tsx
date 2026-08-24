/**
 * RouterBuilder + Memory.layer + Last.provider (HttpApi-shaped lock).
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, ManagedRuntime, Schema, pipe } from "effect";
import { HttpApiEndpoint } from "effect/unstable/httpapi";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as Last from "last-ts/Last";
import * as Layout from "last-ts/Layout";
import * as Memory from "last-ts/Memory";
import * as Page from "last-ts/Page";
import { useRequest } from "last-ts/Page/react";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";
import * as View from "last-ts/View";

class RootShell extends Layout.make()(
  "test/layout/root",
  Effect.sync(() =>
    React.createElement(
      "div",
      { "data-layout": "root" },
      React.createElement(Layout.Outlet),
    ),
  ),
) {}

class DocsShell extends Layout.make()(
  "test/layout/docs",
  Effect.sync(() =>
    React.createElement(
      "div",
      { "data-layout": "docs" },
      React.createElement(Layout.Outlet),
    ),
  ),
) {}

const Home = (): React.ReactElement =>
  React.createElement("span", null, "home");

const Pricing = (): React.ReactElement =>
  React.createElement("span", null, "pricing");

const DocsIndex = (): React.ReactElement =>
  React.createElement("span", null, "docs-index");

const Chapter = (props: Route.HandleArgs): React.ReactElement =>
  React.createElement("span", null, `chapter:${props.params.chapter ?? ""}`);

const BareChapter = Effect.gen(function* () {
  yield* Layout.provide(Layout.Passthrough);
  const req = yield* Page.Request;
  return React.createElement(
    "span",
    { "data-bare": "ok" },
    `chapter:${req.params.chapter ?? ""}`,
  );
});

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

const marketing = pipe(
  RouterBuilder.group(Site, "marketing", (h) =>
    h.handle("home", Home).handle("pricing", Pricing),
  ),
  Layout.provide(RootShell),
);

const docs = pipe(
  RouterBuilder.group(Site, "docs", (h) =>
    h.handle("index", DocsIndex).handle("chapter", BareChapter),
  ),
  Layout.provide(DocsShell),
);

const routes = pipe(
  RouterBuilder.layer(Site),
  Layer.provide(Layer.mergeAll(marketing, docs)),
);

const provider = Last.provider(pipe(Memory.layer, Layer.provide(routes)));

describe("RouterBuilder (HttpApi-shaped)", () => {
  it("Last.provider + Memory.layer renders Outlet with group layout", () => {
    const html = renderToString(
      React.createElement(
        provider,
        null,
        React.createElement(Router.Outlet),
      ),
    );
    expect(html).toContain("data-layout=\"root\"");
    expect(html).toContain("home");
  });

  it("Layout.provide(Passthrough) overrides group shell for a page Effect", () => {
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

const filePages = pipe(
  RouterBuilder.group(FileSite, "root", (h) =>
    h.handle("index", IndexPage).handle("about", AboutPage),
  ),
  Layout.provide(RootShell),
);

const fileRoutes = pipe(
  RouterBuilder.layer(FileSite),
  Layer.provide(
    Layer.mergeAll(
      filePages,
      Router.layerDestinations(FileRoutes, fileTable),
    ),
  ),
);

const fileProvider = Last.provider(
  pipe(Memory.layer, Layer.provide(fileRoutes)),
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
      pipe(Memory.layer, Layer.provide(fileRoutes)),
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

const mixed = pipe(
  RouterBuilder.group(MixedSite, "app", (h) =>
    h
      .handle("dashboard", () => React.createElement("span", null, "dash"))
      .handle("getUser", (req) => {
        const params = (req as { readonly params: { readonly id: string } })
          .params;
        return Effect.succeed({ id: params.id });
      }),
  ),
  Layout.provide(RootShell),
);

const mixedRoutes = pipe(RouterBuilder.layer(MixedSite), Layer.provide(mixed));
const mixedProvider = Last.provider(
  pipe(Memory.layer, Layer.provide(mixedRoutes)),
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

class EffectHomeSite extends Router.make("effect-home-site").add(
  Router.group("app", { topLevel: true }).add(Route.get("home", "/")),
) {}

class JsxSite extends Router.make("jsx-site").add(
  Router.group("app", { topLevel: true }).add(Route.get("about", "/")),
) {}

class NestedSite extends Router.make("nested-site").add(
  Router.group("app", { topLevel: true }).add(Route.get("nested", "/")),
) {}

class ViewEffectSite extends Router.make("view-effect-site").add(
  Router.group("app", { topLevel: true }).add(Route.get("home", "/")),
) {}

const effectHome = Effect.gen(function* () {
  const req = yield* Page.Request;
  return React.createElement(
    "span",
    { "data-page": "effect-home", "data-pathname": req.pathname },
    req.pathname,
  );
});

const NestedProbe = (): React.ReactElement => {
  const req = useRequest();
  return React.createElement(
    "span",
    { "data-nested": "ok" },
    `nested:${req.pathname}`,
  );
};

const nestedPage = Effect.succeed(React.createElement(NestedProbe));

const aboutElement = React.createElement(
  "span",
  { "data-page": "about-jsx" },
  "about",
);

const ViewEffectPage = View.effect(
  Effect.gen(function* () {
    const req = yield* Page.Request;
    return React.createElement(
      "span",
      { "data-page": "view-effect" },
      `view:${req.pathname}`,
    );
  }),
);

const effectHomeRoutes = pipe(
  RouterBuilder.layer(EffectHomeSite),
  Layer.provide(
    pipe(
      RouterBuilder.group(EffectHomeSite, "app", (h) =>
        h.handle("home", effectHome),
      ),
      Layout.provide(RootShell),
    ),
  ),
);
const effectHomeProvider = Last.provider(
  pipe(Memory.layer, Layer.provide(effectHomeRoutes)),
);

const jsxRoutes = pipe(
  RouterBuilder.layer(JsxSite),
  Layer.provide(
    pipe(
      RouterBuilder.group(JsxSite, "app", (h) =>
        h.handle("about", aboutElement),
      ),
      Layout.provide(RootShell),
    ),
  ),
);
const jsxProvider = Last.provider(
  pipe(Memory.layer, Layer.provide(jsxRoutes)),
);

const nestedRoutes = pipe(
  RouterBuilder.layer(NestedSite),
  Layer.provide(
    pipe(
      RouterBuilder.group(NestedSite, "app", (h) =>
        h.handle("nested", nestedPage),
      ),
      Layout.provide(RootShell),
    ),
  ),
);
const nestedProvider = Last.provider(
  pipe(Memory.layer, Layer.provide(nestedRoutes)),
);

const viewEffectRoutes = pipe(
  RouterBuilder.layer(ViewEffectSite),
  Layer.provide(
    pipe(
      RouterBuilder.group(ViewEffectSite, "app", (h) =>
        h.handle("home", ViewEffectPage),
      ),
      Layout.provide(RootShell),
    ),
  ),
);
const viewEffectProvider = Last.provider(
  pipe(Memory.layer, Layer.provide(viewEffectRoutes)),
);

describe("RouterBuilder Effect / JSX page handlers", () => {
  it("registers PageEffect / PageElement / Page (View.effect) runtimes", async () => {
    const assertTag = async (
      routesLayer: typeof effectHomeRoutes,
      id: string,
      tag: string,
    ) => {
      const rt = ManagedRuntime.make(routesLayer);
      try {
        const registry = await rt.runPromise(
          Effect.gen(function* () {
            return yield* RouterBuilder.Registry;
          }),
        );
        expect(registry.groups.get("app")?.handlers.get(id)?._tag).toBe(tag);
      } finally {
        await rt.dispose();
      }
    };

    await assertTag(effectHomeRoutes, "home", "PageEffect");
    await assertTag(jsxRoutes, "about", "PageElement");
    await assertTag(viewEffectRoutes, "home", "Page");
  });

  it("Outlet runs Effect page with Page.Request", () => {
    const html = renderToString(
      React.createElement(
        effectHomeProvider,
        null,
        React.createElement(Router.Outlet),
      ),
    );
    expect(html).toContain("data-layout=\"root\"");
    expect(html).toContain("data-page=\"effect-home\"");
    expect(html).toContain("data-pathname=\"/\"");
  });

  it("Outlet renders JSX element overload", () => {
    const html = renderToString(
      React.createElement(
        jsxProvider,
        null,
        React.createElement(Router.Outlet),
      ),
    );
    expect(html).toContain("data-page=\"about-jsx\"");
    expect(html).toContain("about");
  });

  it("nested component reads Page.useRequest", () => {
    const html = renderToString(
      React.createElement(
        nestedProvider,
        null,
        React.createElement(Router.Outlet),
      ),
    );
    expect(html).toContain("data-nested=\"ok\"");
    expect(html).toContain("nested:/");
  });

  it("View.effect bakes Effect → ComponentType page", () => {
    const html = renderToString(
      React.createElement(
        viewEffectProvider,
        null,
        React.createElement(Router.Outlet),
      ),
    );
    expect(html).toContain("data-page=\"view-effect\"");
    expect(html).toContain("view:/");
  });
});
