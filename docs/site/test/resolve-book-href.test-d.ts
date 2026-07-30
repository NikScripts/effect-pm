/**
 * resolveBookHref / pathOnly — type-level smoke (runtime covered via site usage).
 */
import { expectTypeOf } from "vitest";
import {
  pathOnly,
  resolveBookHref,
  siteHref,
  urls,
} from "../src/lib/siteRoutes";

expectTypeOf(urls.docs("work-pools")).toEqualTypeOf<`/docs/${string}`>();
expectTypeOf(resolveBookHref("/docs/glossary#queue")).toEqualTypeOf<string>();
expectTypeOf(pathOnly("/docs/glossary#queue")).toEqualTypeOf<string>();
expectTypeOf(siteHref("/search?q=a")).toEqualTypeOf<string>();
