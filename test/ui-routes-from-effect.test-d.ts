/**
 * Group.asRoutes + fromEffect — UrlBuilder stays typed (member paths + health).
 */
import { expectTypeOf } from "vitest";
import * as Daemon from "../src/Daemon";
import * as Group from "../src/Group";
import * as Route from "../src/ui/Route";
import * as Router from "../src/ui/Router";

class HttpApi extends Daemon.Service<HttpApi>()("test/fromEffect/HttpApi") {}
class Nwsl extends Group.Service<Nwsl>("test/fromEffect/Nwsl")({ HttpApi }) {}
class Hub extends Group.Service<Hub>("test/fromEffect/Hub")({ Nwsl }) {}

const site = Route.make("site").add(
  Route.get("home", "/home"),
  Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(Hub)),
);

const urls = Route.urlBuilder(site);

expectTypeOf(urls.home()).toEqualTypeOf<string>();
expectTypeOf(urls.health()).toEqualTypeOf<string>();
expectTypeOf(urls.Nwsl.HttpApi()).toEqualTypeOf<string>();
expectTypeOf(urls.Nwsl.HttpApiLogs()).toEqualTypeOf<string>();
expectTypeOf(urls.Nwsl.index()).toEqualTypeOf<string>();
expectTypeOf(urls.nodeHealth("app/NodeA")).toEqualTypeOf<string>();
expectTypeOf(
  urls.nodeHealth("app/NodeA", { query: { panel: "logs" } }),
).toEqualTypeOf<string>();

// @ts-expect-error nodeHealth path param required
urls.nodeHealth();

const router = Router.unsafeService(site, "Memory");
router.to((u) => u.Nwsl.HttpApi());
router.to((u) => u.nodeHealth("x"));
expectTypeOf(router.urls.Nwsl.HttpApi()).toEqualTypeOf<string>();
