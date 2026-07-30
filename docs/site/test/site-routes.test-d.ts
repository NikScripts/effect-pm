/**
 * Path skin — segments as args; assignable to Waku paths.
 */
import { expectTypeOf } from "vitest";
import "../src/pages.gen.js";
import { urls, isSitePath, type SitePath } from "../src/lib/siteRoutes";

expectTypeOf(urls.home()).toEqualTypeOf<"/">();
expectTypeOf(urls.docs("work-pools")).toEqualTypeOf<`/docs/${string}`>();
expectTypeOf(urls.api()).toEqualTypeOf<"/api">();
expectTypeOf(urls.api.pkg("hyperlink-ts")).toEqualTypeOf<`/api/${string}`>();
expectTypeOf(
  urls.api.symbol("effect", "Effect", "succeed"),
).toEqualTypeOf<`/api/${string}/${string}/${string}`>();
expectTypeOf(
  urls.api.symbol("effect", "Effect.succeed"),
).toEqualTypeOf<`/api/${string}/${string}/${string}`>();

const chapter = urls.docs("work-pools");
const _waku: SitePath = chapter;
void _waku;

if (isSitePath(chapter)) {
  const _ok: SitePath = chapter;
  void _ok;
}

// @ts-expect-error junk is not a SitePath
const _junk: SitePath = "/totally-fake";
void _junk;

// @ts-expect-error no HttpApi-style params bag
urls.docs({ params: { chapter: "work-pools" } });
