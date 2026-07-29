/**
 * Example catalog stays typed — nested guides + required api params.
 */
import { expectTypeOf } from "vitest";
import { site, urls } from "../examples/ui/router-mini-docs";
import * as Route from "../src/ui/Route";
import * as Router from "../src/ui/Router";

expectTypeOf(urls.home()).toEqualTypeOf<string>();
expectTypeOf(urls.guides.workPools()).toEqualTypeOf<string>();
expectTypeOf(
  urls.api({ params: { symbol: "Router" } }),
).toEqualTypeOf<string>();

// @ts-expect-error api params required
urls.api();

const router = Router.make(site, "memory");
router.to((u) => u.guides.gates());
expectTypeOf(Route.urlBuilder(site).install()).toEqualTypeOf<string>();
