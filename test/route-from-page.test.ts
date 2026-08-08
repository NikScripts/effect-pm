/**
 * Route.fromPage — Page.extract options/mode → catalog route.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Page from "last-ts/Page";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";

describe("Route.fromPage", () => {
  it("copies Page.make options onto Route.get (dynamic)", () => {
    const params = { slug: Schema.Literals(["routing", "view-service"]) };
    class Chapter extends Page.make({ params }) {}
    const route = Route.fromPage("chapter", "/guides/:slug", Chapter);
    expect(route.identifier).toBe("chapter");
    expect(route.path).toBe("/guides/:slug");
    expect(Route.fromEffectOf(route)).toBeUndefined();
  });

  it("Page.static + Literals → staticFromEffect bags", () => {
    class Chapter extends Page.static({
      params: { slug: Schema.Literals(["routing", "view-service"]) },
    }) {}
    const route = Route.fromPage("chapter", "/guides/:slug", Chapter);
    const ann = Route.fromEffectOf(route);
    expect(ann?.static).toBe(true);
    expect(Effect.runSync(ann!.effect)).toEqual([
      { slug: "routing" },
      { slug: "view-service" },
    ]);
    expect(Effect.runSync(Route.expandStaticPaths(route))).toEqual([
      "/guides/routing",
      "/guides/view-service",
    ]);
  });

  it("types urls from merged page bags", () => {
    class Chapter extends Page.static({
      params: { slug: Schema.Literals(["routing", "view-service"]) },
    }) {}
    class Site extends Router.make("from-page").add(
      Route.fromPage("chapter", "/guides/:slug", Chapter),
    ) {}
    const urls = Route.urlBuilder(Site);
    expect(urls.chapter("routing")).toBe("/guides/routing");
  });

  it("destinationsFromPages merges by id", () => {
    class Chapter extends Page.static({
      params: { slug: Schema.Literals(["routing", "view-service"]) },
    }) {}
    const table = [
      { id: "home", routePath: "/" },
      { id: "chapter", routePath: "/guides/:slug" },
    ] as const;
    const routes = Router.destinationsFromPages(table, {
      chapter: Chapter,
    });
    expect(routes).toHaveLength(2);
    expect(Route.fromEffectOf(routes[1]!)?.static).toBe(true);
    expect(
      Effect.runSync(Route.expandStaticPaths(routes[1]!)),
    ).toEqual(["/guides/routing", "/guides/view-service"]);
  });

  it("pagesByIdFromModules reads Page.asDefault from a glob map", () => {
    class Chapter extends Page.static({
      params: { slug: Schema.Literals(["routing", "view-service"]) },
    }) {
      static Component = () => null;
    }
    const Default = Page.asDefault(Chapter);
    const pages = Router.pagesByIdFromModules({
      "/app/src/pages/guides/[slug].tsx": { default: Default },
      "/app/src/pages/_layout.tsx": { default: () => null },
      "/app/src/pages/index.tsx": {
        default: Page.asDefault(
          class Home extends Page.static() {
            static Component = () => null;
          },
        ),
      },
    });
    expect(Object.keys(pages).sort()).toEqual(["guides_slug", "index"]);
    expect(Page.modeOf(pages.guides_slug!)).toBe("static");
    expect(Router.filePathFromGlobKey("/x/pages/guides/[slug].tsx")).toBe(
      "/guides/[slug]",
    );
  });

  it("fileRootFromPages merges Literals into typed urls", () => {
    class GuidesSlug extends Page.static({
      params: { slug: Schema.Literals(["routing", "view-service"]) },
    }) {}
    const table = [
      { id: "index", routePath: "/" },
      { id: "guides_slug", routePath: "/guides/:slug" },
      { id: "docs_path", routePath: "/docs/*path" },
    ] as const;
    class Site extends Router.make("file-root-pages").add(
      Route.fileRootFromPages(table, { guides_slug: GuidesSlug }),
    ) {}
    const urls = Route.urlBuilder(Site);
    expect(urls.index()).toBe("/");
    expect(urls.guides_slug("routing")).toBe("/guides/routing");
    expect(urls.docs_path("intro/rest")).toBe("/docs/intro/rest");
    const routes = Router.destinationsFromPages(table, {
      guides_slug: GuidesSlug,
    });
    expect(Route.fromEffectOf(routes[1]!)?.static).toBe(true);
  });
});
