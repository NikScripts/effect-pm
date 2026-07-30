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
import * as GroupNav from "../src/ui/GroupNav";
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
    run(Router.memory(hubSite), (router) => {
      GroupNav.open(Hub, router, HttpApi);
      const nav = GroupNav.state(Hub, router);
      expect(nav.keys).toEqual(["Nwsl", "HttpApi"]);
      expect(nav.selected).toBe(HttpApi);
      expect(nav.group).toBe(Nwsl);
      expect(router.pathname).toBe("/Nwsl/HttpApi");
      expect(router.match?.route.identifier).toBe("HttpApi");
      const target = Route.targetOf(router.match);
      expect(target?.kind).toBe("leaf");
      expect(target?.member).toBe(HttpApi);
    });
  });

  it("pathToMember + toHref match short names", () => {
    expect(pathToMember(Hub, HttpApi)).toEqual(["Nwsl", "HttpApi"]);
    expect(pathToMember(Hub, Nwsl)).toEqual(["Nwsl"]);
    expect(GroupNav.toHref(["Nwsl", "HttpApi"])).toBe("/Nwsl/HttpApi");
    expect(GroupNav.toHref([])).toBe("/");
  });

  it("openKey / up walk the tree without corrupting back()", () => {
    run(Router.memory(hubSite), (router) => {
      GroupNav.openKey(Hub, router, "Nwsl");
      expect(GroupNav.state(Hub, router).keys).toEqual(["Nwsl"]);
      expect(GroupNav.state(Hub, router).selected).toBeNull();
      expect(GroupNav.state(Hub, router).group).toBe(Nwsl);
      expect(GroupNav.state(Hub, router).canUp).toBe(true);

      GroupNav.openKey(Hub, router, "HttpApi");
      expect(GroupNav.state(Hub, router).keys).toEqual(["Nwsl", "HttpApi"]);

      GroupNav.up(Hub, router); // replace — stack stays coherent
      expect(GroupNav.state(Hub, router).keys).toEqual(["Nwsl"]);
      router.back();
      expect(GroupNav.state(Hub, router).keys).toEqual([]);
      expect(GroupNav.state(Hub, router).group).toBe(Hub);
      expect(GroupNav.state(Hub, router).canUp).toBe(false);
    });
  });

  it("open then up lands on parent group (deep jump)", () => {
    run(Router.memory(hubSite), (router) => {
      GroupNav.open(Hub, router, HttpApi); // one push to /Nwsl/HttpApi
      GroupNav.up(Hub, router); // replace → /Nwsl
      expect(GroupNav.state(Hub, router).keys).toEqual(["Nwsl"]);
      expect(GroupNav.state(Hub, router).group).toBe(Nwsl);
      GroupNav.up(Hub, router);
      expect(GroupNav.state(Hub, router).keys).toEqual([]);
      router.back();
      expect(GroupNav.state(Hub, router).keys).toEqual([]); // only root remains after replaces
    });
  });

  it("openHealth / openNode use catalog urls", () => {
    run(Router.memory(hubSite), (router) => {
      GroupNav.openKey(Hub, router, "Nwsl");
      GroupNav.openHealth(router);
      expect(GroupNav.state(Hub, router).keys).toEqual(["health"]);
      expect(GroupNav.state(Hub, router).view).toBe("health");
      expect(GroupNav.state(Hub, router).selected).toBeNull();
      expect(GroupNav.state(Hub, router).group).toBe(Hub);
      expect(router.match?.route.identifier).toBe("health");

      GroupNav.openNode(router, "app/NodeA");
      const nodeState = GroupNav.state(Hub, router);
      expect(nodeState.keys).toEqual(["health", "app/NodeA"]);
      expect(nodeState.view).toBe("health");
      expect(GroupNav.toHref(nodeState.keys)).toBe("/health/app/NodeA");
      expect(router.match?.route.identifier).toBe("nodeHealth");
      expect(router.match?.params.nodeId).toBe("app/NodeA");

      GroupNav.up(Hub, router);
      expect(GroupNav.state(Hub, router).keys).toEqual(["health"]);
      GroupNav.up(Hub, router);
      expect(GroupNav.state(Hub, router).keys).toEqual([]);
    });
  });

  it("openLogs stamps leafView Target", () => {
    run(Router.memory(hubSite), (router) => {
      GroupNav.openLogs(Hub, router, HttpApi);
      const nav = GroupNav.state(Hub, router);
      expect(nav.keys).toEqual(["Nwsl", "HttpApi", "logs"]);
      expect(nav.view).toBe("logs");
      expect(nav.selected).toBe(HttpApi);
      expect(router.match?.route.identifier).toBe("HttpApiLogs");
      const target = Route.targetOf(router.match);
      expect(target?.kind).toBe("leafView");
      expect(target?.view).toBe("logs");
    });
  });

  it("Route.targetOf reads Target from match annotations", () => {
    const router = Router.make(hubSite, "memory");
    GroupNav.open(Hub, router, HttpApi);
    expect(Route.targetOf(undefined)).toBeUndefined();
    expect(Route.targetOf(router.match)?.member).toBe(HttpApi);
  });
});
