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
});
