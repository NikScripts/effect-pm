/**
 * Route — HttpApi-shaped catalog, root endpoints, topLevel, addHttpApi.
 */
import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import * as Route from "../src/ui/Route";

describe("Route", () => {
  it("get + params + prefix", () => {
    const node = Route.get("node", "/health/:nodeId").pipe(
      Route.params(Schema.Struct({ nodeId: Schema.String })),
    );
    expect(node.identifier).toBe("node");
    expect(node.path).toBe("/health/:nodeId");
    expect(node.prefix("/app").path).toBe("/app/health/:nodeId");
  });

  it("root endpoints sit on the api (no topLevel needed)", () => {
    const api = Route.make("site").add(
      Route.get("home", "/"),
      Route.get("docs", "/docs"),
    );
    const urls = Route.urlBuilder(api);
    expect(urls.docs()).toBe("/docs");
    expect(Option.getOrThrow(Route.match(api, "/docs")).identifiers).toEqual([
      "docs",
    ]);
  });

  it("group topLevel flattens onto parent builder", () => {
    const api = Route.make("site").add(
      Route.group("shell", { topLevel: true }).add(
        Route.get("health", "/health"),
      ),
      Route.group("app").add(Route.get("dashboard", "/app")),
    );
    const urls = Route.urlBuilder(api);
    expect(urls.health()).toBe("/health");
    expect(urls.app.dashboard()).toBe("/app");
  });

  it("runtime loop uses the same constructors", () => {
    const pages = Route.group("pages", { topLevel: true }).add(
      Route.get("a", "/a"),
      Route.get("b", "/b"),
    );
    const api = Route.make("site").add(pages);
    const urls = Route.urlBuilder(api);
    expect(urls.a()).toBe("/a");
    expect(urls.b()).toBe("/b");
  });

  it("addHttpApi imports Effect HttpApi paths", () => {
    const Wire = HttpApi.make("wire").add(
      HttpApiGroup.make("users", { topLevel: true }).add(
        HttpApiEndpoint.get("getUser", "/users/:id"),
      ),
      HttpApiGroup.make("admin").add(
        HttpApiEndpoint.get("stats", "/admin/stats"),
      ),
    );

    const site = Route.make("site").add(Route.addHttpApi(Wire));
    const urls = Route.urlBuilder(site) as Route.UrlBuilderLoose & {
      getUser: (id: string) => string;
      admin: { stats: () => string };
    };
    expect(urls.getUser("1")).toBe("/users/1");
    expect(urls.admin.stats()).toBe("/admin/stats");
  });

  it("mixes HttpApiGroup with Router.group on Router.make", () => {
    const site = Route.make("site").add(
      HttpApiGroup.make("users").add(
        HttpApiEndpoint.get("getUser", "/users/:id"),
      ),
      Route.group("pages", { topLevel: true }).add(
        Route.get("home", "/"),
      ),
    );
    const urls = Route.urlBuilder(site) as Route.UrlBuilderLoose & {
      home: () => string;
      users: { getUser: (id: string) => string };
    };
    expect(urls.home()).toBe("/");
    expect(urls.users.getUser("42")).toBe("/users/42");
    // UI match is Page success only — bare HttpApiEndpoint is Json/NoContent.
    expect(Option.isSome(Route.match(site, "/"))).toBe(true);
    expect(Option.isNone(Route.match(site, "/users/42"))).toBe(true);
  });

  it("mixes HttpApiEndpoint with Route.get inside a router group", () => {
    const site = Route.make("site").add(
      Route.group("app").add(
        Route.get("dashboard", "/app"),
        // Page success on a wire endpoint — same as Route.get
        HttpApiEndpoint.get("legacy", "/app/legacy", { success: Route.Page }),
      ),
    );
    const urls = Route.urlBuilder(site) as Route.UrlBuilderLoose & {
      app: {
        dashboard: () => string;
        legacy: () => string;
      };
    };
    expect(urls.app.dashboard()).toBe("/app");
    expect(urls.app.legacy()).toBe("/app/legacy");
    expect(Option.getOrThrow(Route.match(site, "/app/legacy")).route.identifier)
      .toBe("legacy");
  });

  it("addHttpApi on the catalog spreads HttpApi groups", () => {
    const Wire = HttpApi.make("wire").add(
      HttpApiGroup.make("users", { topLevel: true }).add(
        HttpApiEndpoint.get("getUser", "/users/:id"),
      ),
      HttpApiGroup.make("admin").add(
        HttpApiEndpoint.get("stats", "/admin/stats"),
      ),
    );
    const site = Route.make("site")
      .addHttpApi(Wire)
      .add(Route.group("pages", { topLevel: true }).add(Route.get("home", "/")));
    // `.addHttpApi` endpoints are runtime-only on the builder (no catalog types) — assert loose.
    const urls = Route.urlBuilder(site) as unknown as Route.UrlBuilderLoose & {
      home: () => string;
      getUser: (id: string) => string;
      admin: { stats: () => string };
    };
    expect(urls.home()).toBe("/");
    expect(urls.getUser("1")).toBe("/users/1");
    expect(urls.admin.stats()).toBe("/admin/stats");
  });

  it("typed urlBuilder uses positional path args", () => {
    const api = Route.make("site").add(
      Route.get("node", "/health/:nodeId").pipe(
        Route.params(Schema.Struct({ nodeId: Schema.String })),
      ),
      Route.get("symbol", "/api/:pkg/:module/:symbol").pipe(
        Route.params(
          Schema.Struct({
            pkg: Schema.String,
            module: Schema.String,
            symbol: Schema.String,
          }),
        ),
      ),
    );
    const urls = Route.urlBuilder(api);
    expect(urls.node("app/NodeA")).toBe("/health/app%2FNodeA");
    expect(urls.symbol("effect", "Effect", "succeed")).toBe(
      "/api/effect/Effect/succeed",
    );
  });

  it("splat *param keeps unencoded slashes", () => {
    const api = Route.make("site").add(
      Route.get("nodeHealth", "/health/*nodeId").pipe(
        Route.params(Schema.Struct({ nodeId: Schema.String })),
      ),
    );
    const urls = Route.urlBuilder(api);
    expect(urls.nodeHealth("app/NodeA")).toBe("/health/app/NodeA");
    expect(urls.nodeHealth("app/Node A")).toBe("/health/app/Node%20A");
    const hit = Option.getOrThrow(Route.match(api, "/health/app/NodeA"));
    expect(hit.params.nodeId).toBe("app/NodeA");
    expect(hit.route.identifier).toBe("nodeHealth");
  });

  it("urlBuilder appends query and preserves it with baseUrl", () => {
    const api = Route.make("site").add(
      Route.get("home", "/home"),
      Route.get("node", "/health/:nodeId").pipe(
        Route.params(Schema.Struct({ nodeId: Schema.String })),
      ),
      Route.group("app").add(Route.get("dashboard", "/app")),
    );
    const urls = Route.urlBuilder(api);
    expect(urls.home({ query: { q: "WorkPool", empty: undefined } })).toBe(
      "/home?q=WorkPool",
    );
    expect(urls.node("x", { query: { tab: "logs" } })).toBe(
      "/health/x?tab=logs",
    );

    const absolute = Route.urlBuilder(api, {
      baseUrl: "https://example.com",
    });
    expect(absolute.home()).toBe("https://example.com/home");
    expect(absolute.app.dashboard()).toBe("https://example.com/app");
    expect(absolute.home({ query: { q: "a" } })).toBe(
      "https://example.com/home?q=a",
    );
  });
});
