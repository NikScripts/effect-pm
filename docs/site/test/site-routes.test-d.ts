/**
 * Site path builders are Waku `Link`/`push`-assignable (static + dynamic).
 */
import { expectTypeOf } from "vitest";
import type { Unstable_InferredPaths as WakuPath } from "waku/router/client";
import "../src/pages.gen.js";
import { path, urls, type SitePath } from "../src/lib/siteRoutes";

expectTypeOf(path.home()).toEqualTypeOf<"/">();
expectTypeOf(path.search()).toEqualTypeOf<"/search">();
expectTypeOf(path.docs("work-pools")).toEqualTypeOf<`/docs/${string}`>();
expectTypeOf(
  path.apiSymbol("effect", "Effect", "succeed"),
).toEqualTypeOf<`/api/${string}/${string}/${string}`>();

// Assignable to Waku inferred paths (pages.gen) — no cast.
const _waku: WakuPath = path.docs("work-pools");
const _site: SitePath = path.apiSymbol("hyperlink-ts", "Route", "handle");
void _waku;
void _site;

// Catalog UrlBuilder stays typed too
expectTypeOf(urls.home()).toEqualTypeOf<string>();
expectTypeOf(
  urls.docs({ params: { chapter: "work-pools" } }),
).toEqualTypeOf<string>();
expectTypeOf(
  urls.apiSymbol({
    params: { pkg: "effect", module: "Effect", symbol: "succeed" },
  }),
).toEqualTypeOf<string>();

// @ts-expect-error chapter params required
urls.docs();

// @ts-expect-error junk path is not a SitePath
const _junk: SitePath = "/totally-fake";
void _junk;
