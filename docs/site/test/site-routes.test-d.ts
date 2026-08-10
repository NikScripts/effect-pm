/**
 * Route.make catalog + positional urls + SSOT vs paths.gen (last-ts file router).
 */
import { expectTypeOf } from "vitest";
import {
  catalog,
  destinations,
  site,
  urls,
  isSitePath,
  type CatalogWakuPath,
  type SitePath,
  type ToWaku,
  type WakuFilePath,
  type WakuFilePathRequired,
} from "../src/lib/siteRoutes";
import * as Router from "../src/ui/Router";

const binding = Router.waku(site);
expectTypeOf(binding._tag).toEqualTypeOf<"WakuBinding">();
expectTypeOf(binding.urls.home).toEqualTypeOf(urls.home);
// @ts-expect-error site skin WakuBinding has no mode field
binding.mode;

expectTypeOf(urls.home()).toEqualTypeOf<"/">();
expectTypeOf(urls.docs("work-pools")).toEqualTypeOf<`/docs/${string}`>();
expectTypeOf(urls.api.index()).toEqualTypeOf<"/api">();
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
void isSitePath;
void destinations;
void catalog;

// @ts-expect-error junk is not a SitePath
const _junk: SitePath = "/totally-fake";
void _junk;

// ----- SSOT: catalog paths → Waku templates ↔ paths.gen -----

expectTypeOf<ToWaku<"/docs/:chapter">>().toEqualTypeOf<"/docs/[chapter]">();
expectTypeOf<
  ToWaku<"/api/:pkg/:module/:symbol">
>().toEqualTypeOf<"/api/[pkg]/[module]/[symbol]">();

type MissingFromCatalog = Exclude<WakuFilePathRequired, CatalogWakuPath>;
type ExtraInCatalog = Exclude<CatalogWakuPath, WakuFilePath>;

expectTypeOf<MissingFromCatalog>().toEqualTypeOf<never>();
expectTypeOf<ExtraInCatalog>().toEqualTypeOf<never>();
