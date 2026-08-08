/**
 * Route.fromEffect / staticFromEffect — annotation + bake flag.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Route from "last-ts/Route";
import { fromEffectOf } from "last-ts/Route";

describe("Route.fromEffect", () => {
  it("annotates dynamic rows", () => {
    const route = Route.get("chapter", "/guides/:slug").pipe(
      Route.fromEffect(
        Effect.succeed([
          { slug: "routing" },
          { slug: "view-service" },
        ]),
      ),
    );
    const meta = fromEffectOf(route);
    expect(meta?.static).toBe(false);
    expect(meta?.effect).toBeDefined();
  });

  it("staticFromEffect marks bake", () => {
    const route = Route.get("chapter", "/guides/:slug").pipe(
      Route.staticFromEffect(
        Effect.succeed([{ slug: "routing" }, { slug: "view-service" }]),
      ),
    );
    expect(fromEffectOf(route)?.static).toBe(true);
  });

  it("expandStaticPaths builds hrefs from literal bags", () => {
    const route = Route.get("chapter", "/guides/:slug").pipe(
      Route.staticFromEffect(
        Effect.succeed([{ slug: "routing" }, { slug: "view-service" }]),
      ),
    );
    const hrefs = Effect.runSync(Route.expandStaticPaths(route));
    expect(hrefs).toEqual(["/guides/routing", "/guides/view-service"]);
  });

  it("mixedFromEffect bakes only the static set", () => {
    const route = Route.get("chapter", "/guides/:slug").pipe(
      Route.mixedFromEffect({
        static: Effect.succeed([{ slug: "routing" as const }]),
        dynamic: Effect.succeed([{ slug: "draft" as const }]),
      }),
    );
    const meta = fromEffectOf(route);
    expect(meta?.static).toBe(true);
    expect(Effect.runSync(meta!.effect)).toEqual([
      { slug: "routing" },
      { slug: "draft" },
    ]);
    expect(Effect.runSync(Route.expandStaticPaths(route))).toEqual([
      "/guides/routing",
    ]);
  });
});
