/**
 * @module examples/last/from-effect
 *
 * Show the value of `group.fromEffect`:
 * - {@link ./Catalog} **class** owns URL grammar (Acme vs Globex Layers)
 * - One {@link ./Catalog.Site} — no hard-coded `.add(Route.get…)` per tenant
 * - {@link Catalog.Urls} — wrong locale / arity / branch is a **compile error**
 *   (see `test/ui-from-effect-typed.test-d.ts`)
 *
 * Run: `pnpm run example:last-from-effect`
 */

import { Effect, Layer, ManagedRuntime, pipe } from "effect";
import * as Memory from "last-ts/Memory";
import * as Router from "last-ts/Router";
import {
  type AcmeUrls,
  type GlobexUrls,
  Catalog,
  Site,
  layerAcme,
  layerGlobex,
  routesFor,
} from "./Catalog";

// Re-export the class API — this *is* the example surface.
export {
  Acme,
  Catalog,
  Globex,
  Site,
  layerAcme,
  layerGlobex,
  routesFor,
  type AcmeUrls,
  type GlobexUrls,
} from "./Catalog";

/**
 * App-facing links for Acme — checked against {@link AcmeUrls}.
 * (Phantom `urls` is type-only; runtime hrefs mirror the same grammar.)
 */
export type AcmeNav = {
  readonly home: ReturnType<AcmeUrls["home"]>;
  readonly pdp: ReturnType<AcmeUrls["content"]["product"]>;
  readonly variant: ReturnType<AcmeUrls["content"]["variant"]>;
  readonly article: ReturnType<AcmeUrls["content"]["article"]>;
};

/** App-facing links for Globex — includes nested `docs.api.symbol`. */
export type GlobexNav = {
  readonly home: ReturnType<GlobexUrls["home"]>;
  readonly pdp: ReturnType<GlobexUrls["content"]["product"]>;
  readonly guide: ReturnType<GlobexUrls["docs"]["guide"]>;
  readonly symbol: ReturnType<GlobexUrls["docs"]["api"]["symbol"]>;
};

const acmeNav = {
  home: "/",
  pdp: "/products/sku_1?ref=hero",
  variant: "/products/sku_1/v/red?ref=grid",
  article: "/de/blog/launch?preview=1",
} as const satisfies AcmeNav;

const globexNav = {
  home: "/",
  pdp: "/products/sku_1?ref=nav",
  guide: "/docs/v2/routing?q=layer",
  symbol: "/docs/v1/api/effect/Effect?src=twoslash",
} as const satisfies GlobexNav;

// =============================================================================
// Runtime — same Site, different Catalog Layer
// =============================================================================

const appLayer = (catalog: Layer.Layer<Catalog>) =>
  pipe(Memory.layer, Layer.provide(routesFor(catalog)));

const demo = (label: string, hrefs: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const router = yield* Router.Router;
    const paths = Object.values(router.api.groups)
      .flatMap((g) =>
        Object.values(g.routes).map((r) => `${g.identifier}.${r.identifier}`),
      )
      .sort();
    yield* Effect.logInfo(`── ${label} ──`);
    yield* Effect.logInfo(`routes: ${paths.join(", ")}`);
    for (const href of hrefs) {
      router.go(href);
      yield* Effect.logInfo(
        `  ${href} → ${router.match?.route.identifier ?? "miss"}`,
      );
    }
  });

const run = (
  label: string,
  catalog: Layer.Layer<Catalog>,
  hrefs: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const rt = ManagedRuntime.make(appLayer(catalog));
    yield* Effect.promise(() => rt.runPromise(demo(label, hrefs)));
    yield* Effect.promise(() => rt.dispose());
  });

void Effect.runPromise(
  Effect.gen(function* () {
    yield* Effect.logInfo(
      "Catalog class → fromEffect Site (Acme vs Globex Layers)",
    );
    yield* Effect.logInfo(`Site id: ${Site.identifier}`);
    yield* run("Acme storefront", layerAcme, [
      acmeNav.pdp,
      acmeNav.variant,
      acmeNav.article,
    ]);
    yield* run("Globex docs", layerGlobex, [
      globexNav.pdp,
      globexNav.guide,
      globexNav.symbol,
    ]);
  }),
);
