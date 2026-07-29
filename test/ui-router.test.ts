/**
 * Router.memory / .history layers over a Route.Api.
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import * as Route from "../src/ui/Route";
import * as Router from "../src/ui/Router";

const site = Route.make("site").add(
  Route.get("home", "/home"),
  Route.group("app").add(Route.get("dashboard", "/app")),
);

const run = <A>(
  layer: Layer.Layer<Router.Router>,
  f: (router: Router.Service) => A,
): A =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(layer);
        return f(Context.get(ctx, Router.Router));
      }),
    ),
  );

describe("Router.memory", () => {
  it("go / to / match / back", () => {
    run(Router.memory(site), (router) => {
      expect(router.pathname).toBe("/");
      expect(router.match).toBeUndefined();

      router.go("/home");
      expect(router.pathname).toBe("/home");
      expect(router.match?.route.identifier).toBe("home");

      router.to((urls) => {
        const app = urls.app as { dashboard: () => string };
        return app.dashboard();
      });
      expect(router.pathname).toBe("/app");
      expect(router.match?.route.identifier).toBe("dashboard");

      router.back();
      expect(router.pathname).toBe("/home");
      router.back();
      expect(router.pathname).toBe("/");
    });
  });

  it("toRoot", () => {
    run(Router.memory(site), (router) => {
      router.go("/app");
      router.toRoot();
      expect(router.pathname).toBe("/");
    });
  });

  it("subscribe fires on navigate", () => {
    run(Router.memory(site), (router) => {
      let n = 0;
      const unsub = router.subscribe(() => {
        n += 1;
      });
      router.go("/home");
      router.go("/home"); // no-op same path
      expect(n).toBe(1);
      unsub();
      router.go("/app");
      expect(n).toBe(1);
    });
  });
});
