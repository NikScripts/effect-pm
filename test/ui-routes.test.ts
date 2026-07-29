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
      getUser: (r: { params: { id: string } }) => string;
      admin: { stats: () => string };
    };
    expect(urls.getUser({ params: { id: "1" } })).toBe("/users/1");
    expect(urls.admin.stats()).toBe("/admin/stats");
  });

  it("typed urlBuilder requires params", () => {
    const api = Route.make("site").add(
      Route.get("node", "/health/:nodeId").pipe(
        Route.params(Schema.Struct({ nodeId: Schema.String })),
      ),
    );
    const urls = Route.urlBuilder(api);
    expect(urls.node({ params: { nodeId: "app/NodeA" } })).toBe(
      "/health/app%2FNodeA",
    );
  });

  it("urlBuilder baseUrl prefixes absolute URLs", () => {
    const api = Route.make("site").add(
      Route.get("home", "/home"),
      Route.group("app").add(Route.get("dashboard", "/app")),
    );
    const urls = Route.urlBuilder(api, {
      baseUrl: "https://example.com",
    });
    expect(urls.home()).toBe("https://example.com/home");
    expect(urls.app.dashboard()).toBe("https://example.com/app");
  });
});
