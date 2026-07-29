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
    // "/" alone does not match; docs does
    const urls = Route.urlBuilder(api) as {
      docs: () => string;
    };
    expect(urls.docs()).toBe("/docs");
    expect(Option.getOrThrow(Route.match(api, "/docs")).identifiers).toEqual([
      "docs",
    ]);
  });

  it("Group.make topLevel flattens onto parent builder", () => {
    const api = Route.make("site").add(
      Route.Group.make("shell", { topLevel: true }).add(
        Route.get("health", "/health"),
      ),
      Route.Group.make("app").add(Route.get("dashboard", "/app")),
    );
    const urls = Route.urlBuilder(api) as {
      health: () => string;
      app: { dashboard: () => string };
    };
    expect(urls.health()).toBe("/health");
    expect(urls.app.dashboard()).toBe("/app");
  });

  it("runtime loop uses the same constructors", () => {
    const entries: ReadonlyArray<readonly [string, `/${string}`]> = [
      ["a", "/a"],
      ["b", "/b"],
    ];
    let pages = Route.Group.make("pages", { topLevel: true });
    for (const [id, path] of entries) {
      pages = pages.add(Route.get(id, path));
    }
    const api = Route.make("site").add(pages);
    const urls = Route.urlBuilder(api) as {
      a: () => string;
      b: () => string;
    };
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

    const site = Route.make("site").add(
      Route.get("home", "/home"),
      Route.addHttpApi(Wire),
    );

    const urls = Route.urlBuilder(site) as {
      home: () => string;
      getUser: (r?: { params?: { id: string } }) => string;
      admin: { stats: () => string };
    };
    expect(urls.home()).toBe("/home");
    expect(urls.getUser({ params: { id: "1" } })).toBe("/users/1");
    expect(urls.admin.stats()).toBe("/admin/stats");

    const hit = Option.getOrThrow(Route.match(site, "/users/42"));
    expect(hit.route.identifier).toBe("getUser");
    expect(hit.params).toEqual({ id: "42" });
  });

  it("Api.addHttpApi method merges the same way", () => {
    const Wire = HttpApi.make("wire").add(
      HttpApiGroup.make("x", { topLevel: true }).add(
        HttpApiEndpoint.get("ping", "/ping"),
      ),
    );
    const site = Route.make("site").addHttpApi(Wire);
    const urls = Route.urlBuilder(site) as { ping: () => string };
    expect(urls.ping()).toBe("/ping");
  });
});
