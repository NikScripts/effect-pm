/**
 * Router.memory / .history — bare Route.Api + Group-backed dashboard helpers.
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import * as Daemon from "../src/Daemon";
import * as Group from "../src/Group";
import { pathToMember } from "../src/ui/GroupRoute";
import * as Route from "../src/ui/Route";
import * as Router from "../src/ui/Router";

const site = Route.make("site").add(
  Route.get("home", "/home"),
  Route.group("app").add(Route.get("dashboard", "/app")),
);

class HttpApi extends Daemon.Tag<HttpApi>()("test/nav/HttpApi") {}
class Nwsl extends Group.Tag<Nwsl>("test/nav/Nwsl")({ HttpApi }) {}
class Hub extends Group.Tag<Hub>("test/nav/Hub")({ Nwsl }) {}

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

describe("Router.memory (Route.Api)", () => {
  it("go / to / match / back", () => {
    run(Router.memory(site), (router) => {
      expect(router.pathname).toBe("/");
      expect(router.match).toBeUndefined();
      expect(router.root).toBeUndefined();

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

describe("Router.memory (Group)", () => {
  it("open by member yields short-name path", () => {
    run(Router.memory(Hub), (nav) => {
      nav.open(HttpApi);
      expect(nav.path).toEqual(["Nwsl", "HttpApi"]);
      expect(nav.selected).toBe(HttpApi);
      expect(nav.group).toBe(Nwsl);
      expect(nav.pathname).toBe("/Nwsl/HttpApi");
      expect(nav.match?.route.identifier).toBe("HttpApi");
    });
  });

  it("pathToMember + toHref match short names", () => {
    expect(pathToMember(Hub, HttpApi)).toEqual(["Nwsl", "HttpApi"]);
    expect(pathToMember(Hub, Nwsl)).toEqual(["Nwsl"]);
    expect(Router.toHref(["Nwsl", "HttpApi"])).toBe("/Nwsl/HttpApi");
    expect(Router.toHref([])).toBe("/");
  });

  it("openKey / up walk the tree", () => {
    run(Router.memory(Hub), (nav) => {
      nav.openKey("Nwsl");
      expect(nav.path).toEqual(["Nwsl"]);
      expect(nav.selected).toBeNull();
      expect(nav.group).toBe(Nwsl);
      nav.openKey("HttpApi");
      expect(nav.path).toEqual(["Nwsl", "HttpApi"]);
      nav.up();
      expect(nav.path).toEqual(["Nwsl"]);
      nav.up();
      expect(nav.path).toEqual([]);
      expect(nav.group).toBe(Hub);
    });
  });

  it("openHealth / openNode are root shell pages", () => {
    run(Router.memory(Hub), (nav) => {
      nav.openKey("Nwsl");
      nav.openHealth();
      expect(nav.path).toEqual(["health"]);
      expect(nav.view).toBe("health");
      expect(nav.selected).toBeNull();
      expect(nav.group).toBe(Hub);
      nav.openNode("app/NodeA");
      expect(nav.path).toEqual(["health", "app/NodeA"]);
      expect(nav.view).toBe("health");
      expect(Router.toHref(nav.path)).toBe("/health/app%2FNodeA");
      nav.up();
      expect(nav.path).toEqual(["health"]);
      nav.up();
      expect(nav.path).toEqual([]);
    });
  });

  it("catalog includes leaf sub-views", () => {
    run(Router.memory(Hub), (nav) => {
      nav.openLogs(HttpApi);
      expect(nav.path).toEqual(["Nwsl", "HttpApi", "logs"]);
      expect(nav.view).toBe("logs");
      expect(nav.match?.route.identifier).toBe("HttpApiLogs");
    });
  });
});
