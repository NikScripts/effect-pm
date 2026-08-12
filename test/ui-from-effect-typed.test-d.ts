/**
 * CMS tree types — recursion, conditionals, narrow param bags — plus fromEffect R.
 */
import { expectTypeOf } from "vitest";
import { Context, Effect, Layer, pipe } from "effect";
import * as Layout from "last-ts/Layout";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";
// Layer used for RouterBuilder.layer R assert
import type { SiteTree, SiteUrls, UrlsOf } from "../examples/last/from-effect/cms";
import {
  contentRoutes,
  docsGroups,
  docsPortalFeatures,
  docsTree,
  storefrontFeatures,
} from "../examples/last/from-effect/cms";

type StorefrontUrls = SiteUrls<typeof storefrontFeatures>;
type DocsPortalUrls = SiteUrls<typeof docsPortalFeatures>;

// =============================================================================
// Conditional SiteTree — variants / docs flip the shape
// =============================================================================

type StorefrontTree = SiteTree<typeof storefrontFeatures>;
type DocsTree = SiteTree<typeof docsPortalFeatures>;

type StorefrontIds = StorefrontTree["id"];
expectTypeOf<StorefrontIds>().toEqualTypeOf<"content">();

type DocsIds = DocsTree["id"];
expectTypeOf<DocsIds>().toEqualTypeOf<"content" | "docs">();

// =============================================================================
// Recursive UrlsOf — nested docs.api.symbol + narrow literals
// =============================================================================

declare const storefront: StorefrontUrls;
declare const docsPortal: DocsPortalUrls;

expectTypeOf(
  storefront.content.product("sku_1", { query: { ref: "hero" } }),
).toEqualTypeOf<string>();
expectTypeOf(
  storefront.content.variant("sku_1", "red", { query: { ref: "grid" } }),
).toEqualTypeOf<string>();
expectTypeOf(
  storefront.content.article("en", "launch", { query: { preview: "1" } }),
).toEqualTypeOf<string>();

// @ts-expect-error storefront has no docs branch
storefront.docs;

// @ts-expect-error locale must be en | de
storefront.content.article("fr", "launch");

// @ts-expect-error variant needs sku + variant
storefront.content.variant("sku_1");

expectTypeOf(
  docsPortal.docs.guide("v2", "routing", { query: { q: "layer" } }),
).toEqualTypeOf<string>();
expectTypeOf(
  docsPortal.docs.api.symbol("v1", "effect", "Effect", {
    query: { src: "twoslash" },
  }),
).toEqualTypeOf<string>();

// @ts-expect-error docs portal has no variant leaf
docsPortal.content.variant;

// @ts-expect-error version must be v1 | v2
docsPortal.docs.guide("v3", "routing");

type ApiUrls = UrlsOf<typeof docsTree>["api"];
expectTypeOf<keyof ApiUrls>().toEqualTypeOf<"symbol">();

type _SiteUrlsAlias = SiteUrls<typeof storefrontFeatures>;
expectTypeOf<StorefrontUrls>().toEqualTypeOf<_SiteUrlsAlias>();

// =============================================================================
// fromEffect — bake R + runtime catalog from the same trees
// =============================================================================

class CmsEdition extends Context.Service<
  CmsEdition,
  "storefront" | "docsPortal"
>()("hyperlink-ts/test/ui-from-effect-typed.test-d/CmsEdition") {}

const content = Route.group("content").fromEffect(
  Effect.gen(function* () {
    const edition = yield* CmsEdition;
    return contentRoutes(edition);
  }),
);

type ContentR = typeof content extends Route.Group<
  infer _Id,
  infer _Routes,
  infer _Groups,
  infer _Top,
  infer R
> ? R
  : never;
expectTypeOf<ContentR>().toEqualTypeOf<CmsEdition>();

const Site = Router.make("typed-cms-tree")
  .add(Route.get("home", "/"), content)
  .groupsFromEffect(
    Effect.gen(function* () {
      const edition = yield* CmsEdition;
      if (edition !== "docsPortal") return [] as const;
      return docsGroups(docsTree);
    }),
  );

type SiteR = Router.Api.Context<typeof Site>;
expectTypeOf<SiteR>().toEqualTypeOf<CmsEdition>();

const home = pipe(
  RouterBuilder.group(Site, "__top", (h) =>
    h.handle("home", () => null),
  ),
  Layout.provide(Layout.Passthrough),
);

const contentHandlers = pipe(
  RouterBuilder.group(Site, "content", (h) =>
    h
      .handle("product", () => null)
      .handle("variant", () => null)
      .handle("article", () => null),
  ),
  Layout.provide(Layout.Passthrough),
);

const routes = pipe(
  RouterBuilder.layer(Site),
  Layer.provide(Layer.mergeAll(home, contentHandlers)),
);

type LayerR = typeof routes extends Layer.Layer<any, any, infer R> ? R
  : never;
type _HasEdition = [CmsEdition] extends [LayerR] ? true : false;
expectTypeOf<true>().toEqualTypeOf<_HasEdition>();
