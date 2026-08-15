/**
 * Route.urlBuilder / Router.make — positional path args + optional query.
 */
import { expectTypeOf } from "vitest";
import { Schema } from "effect";
import * as Route from "../src/ui/Route";
import * as Memory from "last-ts/Memory";
import * as Router from "../src/ui/Router";

const site = Route.make("site").add(
  Route.get("home", "/home"),
  Route.get("node", "/health/:nodeId").pipe(
    Route.params(Schema.Struct({ nodeId: Schema.String })),
  ),
  Route.group("app").add(Route.get("dashboard", "/app")),
);

const urls = Route.urlBuilder(site);

expectTypeOf(urls.home()).toEqualTypeOf<string>();
expectTypeOf(urls.app.dashboard()).toEqualTypeOf<string>();
expectTypeOf(urls.node("x")).toEqualTypeOf<string>();
expectTypeOf(
  urls.node("x", { query: { tab: "1" } }),
).toEqualTypeOf<string>();
expectTypeOf(
  urls.home({ query: { q: "hi" } }),
).toEqualTypeOf<string>();

// @ts-expect-error path param required
urls.node();

const router = Memory.service(site);
router.to((u) => u.app.dashboard());
router.to((u) => u.home());
router.to((u) => u.node("a", { query: { focus: "1" } }));
expectTypeOf(router.urls.home()).toEqualTypeOf<string>();
expectTypeOf(router.search).toEqualTypeOf<string>();
expectTypeOf(router.href).toEqualTypeOf<string>();

// topLevel flattens health + keeps nested group builders (fromEffect shape)
const flat = Route.make("site").add(
  Route.group("hub", { topLevel: true }).add(
    Route.get("health", "/health"),
    Route.group("Nwsl").add(
      Route.get("index", "/Nwsl"),
      Route.get("HttpApi", "/Nwsl/HttpApi"),
    ),
  ),
);
const flatUrls = Route.urlBuilder(flat);
expectTypeOf(flatUrls.health()).toEqualTypeOf<string>();
expectTypeOf(flatUrls.Nwsl.index()).toEqualTypeOf<string>();
expectTypeOf(flatUrls.Nwsl.HttpApi()).toEqualTypeOf<string>();
