/**
 * @module examples/last/from-effect
 *
 * CMS → typed routes (params + query) via `group.fromEffect` /
 * `groupsFromEffect`, then `Router.make().add`.
 *
 * Run: `pnpm run example:last-from-effect`
 */

import { Context, Effect, Layer, ManagedRuntime, Schema, pipe } from "effect";
import * as React from "react";
import * as Layout from "last-ts/Layout";
import * as Memory from "last-ts/Memory";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";

// =============================================================================
// CMS — Layer-swappable source (not a bag of Route.get)
// =============================================================================

/**
 * What the CMS enabled for this site. Route *shapes* are decided in
 * {@link content} / {@link docsGroups}; Layers only swap the flags.
 */
export class Cms extends Context.Service<
  Cms,
  {
    /** PDP includes a variant segment. */
    readonly variants: boolean;
    /** Ship the versioned docs group. */
    readonly docs: boolean;
  }
>()("hyperlink-ts/examples/last/from-effect/main/Cms") {}

/** Storefront CMS: variants on, no docs portal. */
export const cmsStorefront = Layer.succeed(Cms, {
  variants: true,
  docs: false,
});

/** Docs-heavy CMS: simple PDP, versioned guides. */
export const cmsDocsPortal = Layer.succeed(Cms, {
  variants: false,
  docs: true,
});

// =============================================================================
// Routes FROM the CMS Effect → catalog
// =============================================================================

const product = Route.get("product", "/products/:sku", {
  params: { sku: Schema.String },
  query: { ref: Schema.optionalKey(Schema.String) },
});

const variant = Route.get("variant", "/products/:sku/v/:variant", {
  params: { sku: Schema.String, variant: Schema.String },
  query: { ref: Schema.optionalKey(Schema.String) },
});

const article = Route.get("article", "/:locale/blog/:slug", {
  params: {
    locale: Schema.Literals(["en", "de"]),
    slug: Schema.String,
  },
  query: { preview: Schema.optionalKey(Schema.String) },
});

/**
 * Content destinations — param/query grammar depends on {@link Cms}.
 * Identifiers stay stable for {@link Route.UrlBuilder}.
 */
const content = Route.group("content").fromEffect(
  Effect.gen(function* () {
    const cms = yield* Cms;
    return cms.variants
      ? ([product, variant, article] as const)
      : ([product, article] as const);
  }),
);

/** Optional top-level group — only when the CMS publishes docs. */
const docsGroups = Effect.gen(function* () {
  const cms = yield* Cms;
  if (!cms.docs) return [] as const;
  return [
    Route.group("docs").add(
      Route.get("guide", "/docs/:version/:slug", {
        params: { version: Schema.String, slug: Schema.String },
        query: { q: Schema.optionalKey(Schema.String) },
      }).pipe(
        Route.handle(() =>
          React.createElement("article", { "data-page": "guide" }, "Guide"),
        ),
      ),
    ),
  ] as const;
});

/** Catalog — groups from Effect, not Effect→Router. */
export const Site = Router.make("cms-from-effect")
  .add(Route.get("home", "/"), content)
  .groupsFromEffect(docsGroups);

/** Typed links — ids + path arity + query options from the Effect items. */
export type Urls = Route.UrlBuilder<typeof Site>;

// =============================================================================
// Builder — handlers for catalog-known groups
// =============================================================================

const home = pipe(
  RouterBuilder.group(Site, "__top", (h) =>
    h.handle("home", () =>
      React.createElement("h1", { "data-page": "home" }, "Home"),
    ),
  ),
  Layout.provide(Layout.Passthrough),
);

const contentHandlers = pipe(
  RouterBuilder.group(Site, "content", (h) =>
    h
      .handle("product", () =>
        React.createElement("h1", { "data-page": "product" }, "Product"),
      )
      .handle("variant", () =>
        React.createElement("h1", { "data-page": "variant" }, "Variant"),
      )
      .handle("article", () =>
        React.createElement("h1", { "data-page": "article" }, "Article"),
      ),
  ),
  Layout.provide(Layout.Passthrough),
);

export const appLayer = (cms: Layer.Layer<Cms>) =>
  pipe(
    Memory.layer,
    Layer.provide(
      pipe(
        RouterBuilder.layer(Site),
        Layer.provide(Layer.mergeAll(home, contentHandlers)),
        Layer.provide(cms),
      ),
    ),
  );

// =============================================================================
// Demo — build typed hrefs, soft-nav, show what matched
// =============================================================================

const demo = (label: string) =>
  Effect.gen(function* () {
    const router = yield* Router.Router;
    const urls = router.urls as Urls;

    const lines = [
      `── ${label} ──`,
      `groups: ${Object.keys(router.api.groups).sort().join(", ")}`,
      `home          ${urls.home()}`,
      `product       ${urls.content.product("sku_1", { query: { ref: "hero" } })}`,
      `article       ${urls.content.article("en", "launch", { query: { preview: "1" } })}`,
    ];

    if (router.api.groups["content"]?.routes["variant"] !== undefined) {
      lines.push(
        `variant       ${urls.content.variant("sku_1", "red", { query: { ref: "grid" } })}`,
      );
    }
    if (router.api.groups["docs"] !== undefined) {
      lines.push(
        `docs.guide    ${urls.docs.guide("v2", "routing", { query: { q: "layer" } })}`,
      );
    }

    for (const line of lines) {
      yield* Effect.logInfo(line);
    }

    router.go(urls.content.product("sku_1", { query: { ref: "hero" } }));
    yield* Effect.logInfo(`match product → ${router.match?.route.identifier}`);

    router.go(urls.content.article("de", "launch"));
    yield* Effect.logInfo(`match article → ${router.match?.route.identifier}`);
  });

const run = (label: string, cms: Layer.Layer<Cms>) =>
  Effect.gen(function* () {
    const rt = ManagedRuntime.make(appLayer(cms));
    yield* Effect.promise(() => rt.runPromise(demo(label)));
    yield* Effect.promise(() => rt.dispose());
  });

void Effect.runPromise(
  Effect.gen(function* () {
    yield* Effect.logInfo("CMS → fromEffect routes (typed params + query)");
    yield* run("storefront (variants)", cmsStorefront);
    yield* run("docs portal", cmsDocsPortal);
  }),
);
