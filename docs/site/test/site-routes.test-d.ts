/**
 * Route.make catalog + positional urls + SSOT vs pages.gen.
 */
import { expectTypeOf } from "vitest";
import "../src/pages.gen.js";
import {
  destinations,
  site,
  urls,
  isSitePath,
  type CatalogWakuPath,
  type SitePath,
  type WakuFilePath,
  type WakuFilePathRequired,
} from "../src/lib/siteRoutes";
import * as Router from "../src/ui/Router";

const router = Router.make(site);
expectTypeOf(router.mode).toEqualTypeOf<"waku">();
expectTypeOf(router.urls.home).toEqualTypeOf(urls.home);

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

// @ts-expect-error junk is not a SitePath
const _junk: SitePath = "/totally-fake";
void _junk;

// ----- SSOT: destinations.waku ↔ pages.gen Page.path -----

type MissingFromCatalog = Exclude<WakuFilePathRequired, CatalogWakuPath>;
type ExtraInCatalog = Exclude<CatalogWakuPath, WakuFilePath>;

expectTypeOf<MissingFromCatalog>().toEqualTypeOf<never>();
expectTypeOf<ExtraInCatalog>().toEqualTypeOf<never>();
