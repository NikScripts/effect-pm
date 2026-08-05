/**
 * Example catalog stays typed — nested guides + required api path args.
 */
import { expectTypeOf } from "vitest";
import { site, urls } from "../examples/ui/router-mini-docs";
import * as Route from "../src/ui/Route";
import * as Router from "../src/ui/Router";

expectTypeOf(urls.home()).toEqualTypeOf<string>();
expectTypeOf(urls.guides.workPools()).toEqualTypeOf<string>();
expectTypeOf(urls.api("Router")).toEqualTypeOf<string>();
expectTypeOf(
  urls.api("Router", { query: { src: "1" } }),
).toEqualTypeOf<string>();

// @ts-expect-error api path param required
urls.api();

const router = Router.unsafeService(site, "Memory");
router.to((u) => u.guides.gates());
expectTypeOf(Route.urlBuilder(site).install()).toEqualTypeOf<string>();
