/**
 * Vision catalog + Waku path narrowing — static and dynamic.
 */
import { expectTypeOf } from "vitest";
import "../src/pages.gen.js";
import { urls, isSitePath, type SitePath } from "../src/lib/siteRoutes";

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

const chapter = urls.docs({ params: { chapter: "work-pools" } });
if (isSitePath(chapter)) {
  const _ok: SitePath = chapter;
  void _ok;
}

// @ts-expect-error junk is not a SitePath without narrowing
const _junk: SitePath = "/totally-fake";
void _junk;
