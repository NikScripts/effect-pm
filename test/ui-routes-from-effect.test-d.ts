/**
 * Group.asRoutes + fromEffect — UrlBuilder stays typed (member paths + health).
 */
import { expectTypeOf } from "vitest";
import * as Daemon from "../src/Daemon";
import * as Group from "../src/Group";
import * as Route from "../src/ui/Route";
import * as Router from "../src/ui/Router";

class HttpApi extends Daemon.Tag<HttpApi>()("test/fromEffect/HttpApi") {}
class Nwsl extends Group.Tag<Nwsl>("test/fromEffect/Nwsl")({ HttpApi }) {}
class Hub extends Group.Tag<Hub>("test/fromEffect/Hub")({ Nwsl }) {}

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
expectTypeOf(
  urls.healthNode({ params: { nodeId: "app/NodeA" } }),
).toEqualTypeOf<string>();

// @ts-expect-error healthNode params required
urls.healthNode();

const router = Router.make(site, "memory");
router.to((u) => u.Nwsl.HttpApi());
router.to((u) => u.healthNode({ params: { nodeId: "x" } }));
expectTypeOf(router.urls.Nwsl.HttpApi()).toEqualTypeOf<string>();
