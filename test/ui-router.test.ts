/**
 * Router.memory / .history — Route.Api only; Group via asRoutes + fromEffect.
 */
import { createElement } from "react";
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { renderToString } from "react-dom/server";
import * as Daemon from "../src/Daemon";
import * as Group from "../src/Group";
import { pathToMember } from "../src/internal/uiGroupRoutes";
import * as Route from "../src/ui/Route";
import * as Router from "../src/ui/Router";

const site = Route.make("site").add(
  Route.get("home", "/home"),
  Route.group("app").add(Route.get("dashboard", "/app")),
);

class HttpApi extends Daemon.Tag<HttpApi>()("test/nav/HttpApi") {}
class Nwsl extends Group.Tag<Nwsl>("test/nav/Nwsl")({ HttpApi }) {}
class Hub extends Group.Tag<Hub>("test/nav/Hub")({ Nwsl }) {}

const hubSite = Route.make("hub").add(
  Route.group("tree", { topLevel: true }).fromEffect(Group.asRoutes(Hub)),
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

describe("Router.make (typed)", () => {
  it("to / urls are catalog-typed", () => {
    const router = Router.make(site, "memory");
    router.to((urls) => urls.app.dashboard());
    expect(router.pathname).toBe("/app");
    expect(router.urls.home()).toBe("/home");
  });
});

describe("Route.handle + Router.Outlet", () => {
  it("Outlet renders the matched handle with params", () => {
    const app = Route.make("app").add(
      Route.get("home", "/home").pipe(
        Route.handle(() => createElement("span", null, "home")),
      ),
      Route.get("user", "/users/:id").pipe(
        Route.params(Schema.Struct({ id: Schema.String })),
        Route.handle(({ params }) =>
          createElement("span", null, `user:${params.id}`),
        ),
      ),
    );
    const router = Router.make(app, "memory");
    router.go("/users/42");
    expect(Route.handleOf(router.match)).toBeDefined();

    const html = renderToString(
      createElement(Router.Provider, {
        value: router,
        children: createElement(Router.Outlet),
      }),
    );
    expect(html).toContain("user:42");
  });

  it("to + Outlet carry query on href / HandleArgs", () => {
    const app = Route.make("app").add(
      Route.get("user", "/users/:id").pipe(
        Route.params(Schema.Struct({ id: Schema.String })),
        Route.handle(({ params, query, href }) =>
          createElement(
            "span",
            null,
            `${params.id}:${query.tab ?? ""}:${href}`,
          ),
        ),
      ),
    );
    const router = Router.make(app, "memory");
    router.to((u) => u.user("42", { query: { tab: "bio" } }));
    expect(router.pathname).toBe("/users/42");
    expect(router.search).toBe("?tab=bio");
    expect(router.href).toBe("/users/42?tab=bio");

    const html = renderToString(
      createElement(Router.Provider, {
        value: router,
        children: createElement(Router.Outlet),
      }),
    );
    expect(html).toContain("42:bio:/users/42?tab=bio");
  });
});

describe("Router.memory (Route.Api)", () => {
  it("go / to / match / back", () => {
    run(Router.memory(site), (router) => {
      expect(router.pathname).toBe("/");
      expect(router.match).toBeUndefined();
      expect(router.root).toBeUndefined();

      router.go("/home");
      expect(router.pathname).toBe("/home");
      expect(router.match?.route.identifier).toBe("home");

      router.go("/app");
      expect(router.pathname).toBe("/app");
      expect(router.match?.route.identifier).toBe("dashboard");

      router.back();
      expect(router.pathname).toBe("/home");
      router.back();
      expect(router.pathname).toBe("/");
    });
  });

  it("go({ replace }) does not deepen the memory stack", () => {
    run(Router.memory(site), (router) => {
      router.go("/home");
      router.go("/app", { replace: true });
      expect(router.pathname).toBe("/app");
      router.back();
      expect(router.pathname).toBe("/");
    });
  });

  it("toRoot replaces to /", () => {
    run(Router.memory(site), (router) => {
      router.go("/app");
      router.toRoot();
      expect(router.pathname).toBe("/");
      router.back();
      expect(router.pathname).toBe("/"); // stack collapsed to root
    });
  });

  it("Group helpers fail loud without DashboardRoot", () => {
    run(Router.memory(site), (router) => {
      expect(() => router.openKey("x")).toThrow(/DashboardRoot/);
      expect(() => router.up()).toThrow(/DashboardRoot/);
      expect(() => router.openHealth()).toThrow(/DashboardRoot/);
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

describe("Group.asRoutes + fromEffect", () => {
  it("open by member yields short-name path + Target match", () => {
    run(Router.memory(hubSite), (nav) => {
      expect(nav.root).toBe(Hub);
      nav.open(HttpApi);
      expect(nav.path).toEqual(["Nwsl", "HttpApi"]);
      expect(nav.selected).toBe(HttpApi);
      expect(nav.group).toBe(Nwsl);
      expect(nav.pathname).toBe("/Nwsl/HttpApi");
      expect(nav.match?.route.identifier).toBe("HttpApi");
      const target = Route.targetOf(nav.match);
      expect(target?.kind).toBe("leaf");
      expect(target?.member).toBe(HttpApi);
    });
  });

  it("pathToMember + toHref match short names", () => {
    expect(pathToMember(Hub, HttpApi)).toEqual(["Nwsl", "HttpApi"]);
    expect(pathToMember(Hub, Nwsl)).toEqual(["Nwsl"]);
    expect(Router.toHref(["Nwsl", "HttpApi"])).toBe("/Nwsl/HttpApi");
    expect(Router.toHref([])).toBe("/");
  });

  it("openKey / up walk the tree without corrupting back()", () => {
    run(Router.memory(hubSite), (nav) => {
      nav.openKey("Nwsl");
      expect(nav.path).toEqual(["Nwsl"]);
      expect(nav.selected).toBeNull();
      expect(nav.group).toBe(Nwsl);
      expect(nav.canUp).toBe(true);

      nav.openKey("HttpApi");
      expect(nav.path).toEqual(["Nwsl", "HttpApi"]);

      nav.up(); // replace — stack stays coherent
      expect(nav.path).toEqual(["Nwsl"]);
      nav.back();
      expect(nav.path).toEqual([]);
      expect(nav.group).toBe(Hub);
      expect(nav.canUp).toBe(false);
    });
  });

  it("open then up lands on parent group (deep jump)", () => {
    run(Router.memory(hubSite), (nav) => {
      nav.open(HttpApi); // one push to /Nwsl/HttpApi
      nav.up(); // replace → /Nwsl
      expect(nav.path).toEqual(["Nwsl"]);
      expect(nav.group).toBe(Nwsl);
      nav.up();
      expect(nav.path).toEqual([]);
      nav.back();
      expect(nav.path).toEqual([]); // only root remains after replaces
    });
  });

  it("openHealth / openNode use catalog urls", () => {
    run(Router.memory(hubSite), (nav) => {
      nav.openKey("Nwsl");
      nav.openHealth();
      expect(nav.path).toEqual(["health"]);
      expect(nav.view).toBe("health");
      expect(nav.selected).toBeNull();
      expect(nav.group).toBe(Hub);
      expect(nav.match?.route.identifier).toBe("health");

      nav.openNode("app/NodeA");
      expect(nav.path).toEqual(["health", "app/NodeA"]);
      expect(nav.view).toBe("health");
      expect(Router.toHref(nav.path)).toBe("/health/app/NodeA");
      expect(nav.match?.route.identifier).toBe("nodeHealth");
      expect(nav.match?.params.nodeId).toBe("app/NodeA");

      nav.up();
      expect(nav.path).toEqual(["health"]);
      nav.up();
      expect(nav.path).toEqual([]);
    });
  });

  it("openLogs stamps leafView Target", () => {
    run(Router.memory(hubSite), (nav) => {
      nav.openLogs(HttpApi);
      expect(nav.path).toEqual(["Nwsl", "HttpApi", "logs"]);
      expect(nav.view).toBe("logs");
      expect(nav.selected).toBe(HttpApi);
      expect(nav.match?.route.identifier).toBe("HttpApiLogs");
      const target = Route.targetOf(nav.match);
      expect(target?.kind).toBe("leafView");
      expect(target?.view).toBe("logs");
    });
  });

  it("Route.targetOf reads Target from match annotations", () => {
    const router = Router.make(hubSite, "memory");
    router.open(HttpApi);
    expect(Route.targetOf(undefined)).toBeUndefined();
    expect(Route.targetOf(router.match)?.member).toBe(HttpApi);
  });
});
