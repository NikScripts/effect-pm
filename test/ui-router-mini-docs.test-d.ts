/**
 * Example catalog stays typed — nested guides + required api path args.
 */
import { expectTypeOf } from "vitest";
import { site, urls } from "../examples/ui/router-mini-docs";
import * as Route from "../src/ui/Route";
import * as Memory from "last-ts/Memory";

expectTypeOf(urls.home()).toEqualTypeOf<Route.PathHref<"/">>();
expectTypeOf(urls.guides.workPools()).toEqualTypeOf<Route.PathHref<"/guides/work-pools">>();
expectTypeOf(urls.api("Router")).toEqualTypeOf<Route.PathHref<"/api/:symbol">>();
expectTypeOf(
  urls.api("Router", { query: { src: "1" } }),
).toEqualTypeOf<Route.PathHref<"/api/:symbol">>();

// @ts-expect-error api path param required
urls.api();

const router = Memory.service(site);
router.to((u) => u.guides.gates());
expectTypeOf(Route.urlBuilder(site).install()).toEqualTypeOf<
  Route.PathHref<"/getting-started/install">
>();
