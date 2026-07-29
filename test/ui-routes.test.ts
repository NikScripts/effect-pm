/**
 * Route (HttpApi-shaped) + GroupRoute.from (dynamic).
 */
import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import * as Daemon from "../src/Daemon";
import * as Group from "../src/Group";
import * as GroupRoute from "../src/ui/GroupRoute";
import * as Route from "../src/ui/Route";

class HttpApi extends Daemon.Tag<HttpApi>()("test/routes/HttpApi") {}
class Nwsl extends Group.Tag<Nwsl>("test/routes/Nwsl")({ HttpApi }) {}
class Hub extends Group.Tag<Hub>("test/routes/Hub")({ Nwsl }) {}

describe("Route", () => {
  it("get + params + prefix", () => {
    const node = Route.get("node", "/health/:nodeId").pipe(
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
  });
});

describe("GroupRoute.from", () => {
  const api = Route.make("dashboard").add(
    GroupRoute.from(Hub, {
      leaf: (g, ctx) => g.add(...GroupRoute.gets(ctx, "logs", "schedule")),
    }),
    Route.group("shell", { topLevel: true }).add(
      Route.get("health", "/health"),
      Route.get("node", "/health/:nodeId").pipe(
        Route.params(Schema.Struct({ nodeId: Schema.String })),
      ),
    ),
  );

  it("urlBuilder nests Group members + leaf gets", () => {
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

  it("match resolves group, leaf, leaf get, and params", () => {
    const leaf = Option.getOrThrow(Route.match(api, "/Nwsl/HttpApi"));
    expect(leaf.kind).toBe("group");
    expect(leaf.member).toBe(HttpApi);

    const logs = Option.getOrThrow(Route.match(api, "/Nwsl/HttpApi/logs"));
    expect(logs.kind).toBe("route");
    expect(logs.leafView).toBe("logs");
    expect(logs.member).toBe(HttpApi);

    const node = Option.getOrThrow(Route.match(api, "/health/app%2FNode"));
    expect(node.params).toEqual({ nodeId: "app/Node" });
  });

  it("hand-written tree equals GroupRoute.from paths", () => {
    const hand = Route.make("hand").add(
      Route.group("hub", { path: undefined }).add(
        Route.group("Nwsl", { path: "/Nwsl" }).add(
          Route.group("HttpApi", { path: "/Nwsl/HttpApi" }).add(
            Route.get("logs", "/Nwsl/HttpApi/logs"),
          ),
        ),
      ),
    );
    // Hand tree without topLevel won't flatten the same — compare generated
    // flatten paths against an equivalent from() without shell.
    const generated = Route.make("gen").add(
      GroupRoute.from(Hub, {
        leaf: (g, ctx) => g.add(...GroupRoute.gets(ctx, "logs")),
      }),
    );
    const paths = Route.flatten(generated)
      .map((e) => e.path)
      .slice()
      .sort();
    expect(paths).toEqual([
      "/Nwsl",
      "/Nwsl/HttpApi",
      "/Nwsl/HttpApi/logs",
    ]);
    // Hand-written nested (non-topLevel) still has the same path strings.
    expect(
      Route.flatten(hand)
        .map((e) => e.path)
        .slice()
        .sort(),
    ).toEqual(paths);
  });
});
