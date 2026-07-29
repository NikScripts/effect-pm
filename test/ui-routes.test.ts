/**
 * Route app catalog + groupRoute.routes (Group → Route.Group).
 */
import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import * as Daemon from "../src/Daemon";
import * as Group from "../src/Group";
import { routes } from "../src/ui/groupRoute";
import * as Route from "../src/ui/Route";

class HttpApi extends Daemon.Tag<HttpApi>()("test/routes/HttpApi") {}
class Nwsl extends Group.Tag<Nwsl>("test/routes/Nwsl")({ HttpApi }) {}
class Hub extends Group.Tag<Hub>("test/routes/Hub")({ Nwsl }) {}

describe("Route", () => {
  it("make + params + prefix", () => {
    const node = Route.make("node", "/health/:nodeId").pipe(
      Route.params(Schema.Struct({ nodeId: Schema.String })),
    );
    expect(node.identifier).toBe("node");
    expect(node.path).toBe("/health/:nodeId");
    expect(node.prefix("/app").path).toBe("/app/health/:nodeId");
  });

  it("compilePath builds and matches", () => {
    const compiled = Route.compilePath("/health/:nodeId");
    expect(compiled.build({ nodeId: "a/b" })).toBe("/health/a%2Fb");
    expect(Option.getOrThrow(compiled.match("/health/a%2Fb"))).toEqual({
      nodeId: "a/b",
    });
    expect(Option.isNone(compiled.match("/other"))).toBe(true);
  });
});

describe("groupRoute.routes", () => {
  const api = Route.app("dashboard").add(
    routes(Hub, { leafViews: ["logs", "schedule"] }),
    Route.group("shell", { topLevel: true }).add(
      Route.make("health", "/health"),
      Route.make("node", "/health/:nodeId").pipe(
        Route.params(Schema.Struct({ nodeId: Schema.String })),
      ),
    ),
  );

  it("urlBuilder nests Group members + leaf views", () => {
    const urls = Route.urlBuilder(api) as {
      health: () => string;
      node: (r?: { params?: { nodeId: string } }) => string;
      Nwsl: (() => string) & {
        HttpApi: (() => string) & {
          logs: () => string;
          schedule: () => string;
        };
      };
    };
    expect(urls.health()).toBe("/health");
    expect(urls.node({ params: { nodeId: "n1" } })).toBe("/health/n1");
    expect(urls.Nwsl()).toBe("/Nwsl");
    expect(urls.Nwsl.HttpApi()).toBe("/Nwsl/HttpApi");
    expect(urls.Nwsl.HttpApi.logs()).toBe("/Nwsl/HttpApi/logs");
    expect(urls.Nwsl.HttpApi.schedule()).toBe("/Nwsl/HttpApi/schedule");
  });

  it("match resolves group, leaf, leaf view, and params", () => {
    const leaf = Option.getOrThrow(Route.match(api, "/Nwsl/HttpApi"));
    expect(leaf.kind).toBe("group");
    expect(leaf.identifiers).toEqual(["Nwsl", "HttpApi"]);
    expect(leaf.member).toBe(HttpApi);
    expect(leaf.leafView).toBeUndefined();

    const logs = Option.getOrThrow(Route.match(api, "/Nwsl/HttpApi/logs"));
    expect(logs.kind).toBe("route");
    expect(logs.leafView).toBe("logs");
    expect(logs.member).toBe(HttpApi);

    const group = Option.getOrThrow(Route.match(api, "/Nwsl"));
    expect(group.member).toBe(Nwsl);

    const node = Option.getOrThrow(Route.match(api, "/health/app%2FNode"));
    expect(node.identifiers).toEqual(["node"]);
    expect(node.params).toEqual({ nodeId: "app/Node" });
  });

  it("hand-written tree equals groupRoute.routes paths", () => {
    const hand = Route.app("hand").add(
      Route.group("hub", { topLevel: true }).add(
        Route.group("Nwsl", { path: "/Nwsl" }).add(
          Route.group("HttpApi", { path: "/Nwsl/HttpApi" }).add(
            Route.make("logs", "/Nwsl/HttpApi/logs"),
          ),
        ),
      ),
    );
    const generated = Route.app("gen").add(
      routes(Hub, { leafViews: ["logs"] }),
    );
    const handPaths = Route.flatten(hand)
      .map((e) => e.path)
      .slice()
      .sort();
    const genPaths = Route.flatten(generated)
      .map((e) => e.path)
      .slice()
      .sort();
    expect(genPaths).toEqual(handPaths);
  });
});
