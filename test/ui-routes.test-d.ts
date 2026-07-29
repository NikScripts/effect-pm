/**
 * Route.urlBuilder / Router.make — typed like HttpApiClient.urlBuilder.
 */
import { expectTypeOf } from "vitest";
import { Schema } from "effect";
import * as Route from "../src/ui/Route";
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
expectTypeOf(
  urls.node({ params: { nodeId: "x" } }),
).toEqualTypeOf<string>();

// @ts-expect-error params required
urls.node();

const router = Router.make(site, "memory");
router.to((u) => u.app.dashboard());
router.to((u) => u.home());
expectTypeOf(router.urls.home()).toEqualTypeOf<string>();
