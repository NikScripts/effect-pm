/**
 * @module examples/last/from-effect
 *
 * Fancy CMS types → `fromEffect` / `groupsFromEffect` catalog.
 *
 * The type show is {@link ./cms} (`SiteUrls`, recursive `UrlsOf`, conditional
 * `SiteTree`). This file wires const trees into a Router and prints typed links.
 *
 * Run: `pnpm run example:last-from-effect`
 */

import { Context, Effect, Layer, ManagedRuntime, pipe } from "effect";
import * as React from "react";
import * as Layout from "last-ts/Layout";
import * as Memory from "last-ts/Memory";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";
import {
  type SiteUrls,
  contentRoutes,
  docsGroups,
  docsPortalFeatures,
  docsTree,
  storefrontFeatures,
} from "./cms";

// =============================================================================
// Which CMS tree is live — Layer-swapped
// =============================================================================

export class CmsEdition extends Context.Service<
  CmsEdition,
  "storefront" | "docsPortal"
>()("hyperlink-ts/examples/last/from-effect/main/CmsEdition") {}

export const layerStorefront = Layer.succeed(CmsEdition, "storefront");
export const layerDocsPortal = Layer.succeed(CmsEdition, "docsPortal");

// =============================================================================
// Catalog — trees from Effect (not Effect→Router)
// =============================================================================

const content = Route.group("content").fromEffect(
  Effect.gen(function* () {
    const edition = yield* CmsEdition;
    return contentRoutes(edition);
  }),
);

const Site = Router.make("cms-types-from-effect")
  .add(Route.get("home", "/"), content)
  .groupsFromEffect(
    Effect.gen(function* () {
      const edition = yield* CmsEdition;
      if (edition !== "docsPortal") return [] as const;
      return docsGroups(docsTree);
    }),
  );

/** Compile-time storefront URL surface — see `test/ui-from-effect-typed.test-d.ts`. */
export type StorefrontUrls = SiteUrls<typeof storefrontFeatures>;

/** Docs portal — nested `docs.api.symbol`. */
export type DocsPortalUrls = SiteUrls<typeof docsPortalFeatures>;

export { docsPortalFeatures, storefrontFeatures };

// =============================================================================
// Builder
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
        React.createElement("span", { "data-page": "product" }, "product"),
      )
      .handle("variant", () =>
        React.createElement("span", { "data-page": "variant" }, "variant"),
      )
      .handle("article", () =>
        React.createElement("span", { "data-page": "article" }, "article"),
      ),
  ),
  Layout.provide(Layout.Passthrough),
);

export const appLayer = (edition: Layer.Layer<CmsEdition>) =>
  pipe(
    Memory.layer,
    Layer.provide(
      pipe(
        RouterBuilder.layer(Site),
        Layer.provide(Layer.mergeAll(home, contentHandlers)),
        Layer.provide(edition),
      ),
    ),
  );

// =============================================================================
// Demo — live soft-nav (fancy URL types live in the `.test-d.ts`)
// =============================================================================

const demo = (label: string) =>
  Effect.gen(function* () {
    const router = yield* Router.Router;
    const hrefs = Object.values(router.api.groups).flatMap((g) =>
      Object.values(g.routes).map(
        (r) => `${g.identifier}.${r.identifier}  ${r.path}`,
      ),
    );
    yield* Effect.logInfo(`── ${label} ──`);
    for (const line of hrefs.sort()) {
      yield* Effect.logInfo(line);
    }
    router.go("/products/sku_1?ref=hero");
    yield* Effect.logInfo(`go product → ${router.match?.route.identifier}`);
    router.go("/docs/v2/api/effect/Effect?src=twoslash");
    yield* Effect.logInfo(
      `go symbol → ${router.match?.route.identifier ?? "no match"}`,
    );
  });

const run = (label: string, edition: Layer.Layer<CmsEdition>) =>
  Effect.gen(function* () {
    const rt = ManagedRuntime.make(appLayer(edition));
    yield* Effect.promise(() => rt.runPromise(demo(label)));
    yield* Effect.promise(() => rt.dispose());
  });

void Effect.runPromise(
  Effect.gen(function* () {
    yield* Effect.logInfo("CMS tree types → fromEffect catalog");
    yield* run("storefront", layerStorefront);
    yield* run("docs portal", layerDocsPortal);
  }),
);
