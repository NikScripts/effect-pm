/**
 * @module examples/last/from-effect/Catalog
 *
 * **Value of `fromEffect`:** one Router catalog; a {@link Catalog} service
 * class owns URL grammar (params, query, which branches exist). Swap the Layer
 * — Acme storefront vs Globex docs — without rewriting `.add(Route.get…)`.
 * App code links through {@link Catalog.Urls} so wrong locale / arity / missing
 * branch fails at compile time.
 */
import { Context, Effect, Layer, Schema, pipe } from "effect";
import * as React from "react";
import * as Layout from "last-ts/Layout";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";

// =============================================================================
// Catalog service — Layer-swappable URL grammar (not a list of Route.get)
// =============================================================================

export class Catalog extends Context.Service<Catalog, Catalog.Spec>()(
  "hyperlink-ts/examples/last/from-effect/Catalog",
) {}

export declare namespace Catalog {
  /** Acme — PDP + variants + localized blog. */
  export interface Storefront {
    readonly _tag: "Storefront";
    readonly locales: readonly ["en", "de"];
    readonly variants: true;
  }

  /** Globex — docs portal (nested api.symbol) + simple PDP + blog. */
  export interface DocsPortal {
    readonly _tag: "DocsPortal";
    readonly locales: readonly ["en", "de"];
    readonly versions: readonly ["v1", "v2"];
    readonly variants: false;
  }

  export type Spec = Storefront | DocsPortal;

  export type Locale<S extends Spec = Spec> = S["locales"][number];
  export type Version<S extends Spec> = S extends DocsPortal
    ? S["versions"][number]
    : never;

  /**
   * Typed link surface for a concrete {@link Spec}.
   * Recursive docs nest; storefront has `variant` and no `docs`.
   */
  export type Urls<S extends Spec> = {
    readonly home: () => string;
    readonly content: {
      readonly product: (
        sku: string,
        options?: { readonly query?: { readonly ref?: string } },
      ) => string;
      readonly article: (
        locale: Locale<S>,
        slug: string,
        options?: { readonly query?: { readonly preview?: string } },
      ) => string;
    } & (S["variants"] extends true ? {
      readonly variant: (
        sku: string,
        variant: string,
        options?: { readonly query?: { readonly ref?: string } },
      ) => string;
    }
      : unknown);
  } & (S extends DocsPortal ? {
    readonly docs: {
      readonly guide: (
        version: Version<S>,
        slug: string,
        options?: { readonly query?: { readonly q?: string } },
      ) => string;
      readonly api: {
        readonly symbol: (
          version: Version<S>,
          pkg: string,
          name: string,
          options?: { readonly query?: { readonly src?: string } },
        ) => string;
      };
    };
  }
    : unknown);
}

export const Acme: Catalog.Storefront = {
  _tag: "Storefront",
  locales: ["en", "de"],
  variants: true,
};

export const Globex: Catalog.DocsPortal = {
  _tag: "DocsPortal",
  locales: ["en", "de"],
  versions: ["v1", "v2"],
  variants: false,
};

export const layerAcme = Layer.succeed(Catalog, Acme);
export const layerGlobex = Layer.succeed(Catalog, Globex);

// =============================================================================
// Destinations — narrow schemas; selected by Catalog in fromEffect
// =============================================================================

const page = (el: React.ReactElement) => Route.handle(() => el);

const product = Route.get("product", "/products/:sku", {
  params: { sku: Schema.String },
  query: { ref: Schema.optionalKey(Schema.String) },
}).pipe(page(React.createElement("span", { "data-page": "product" }, "product")));

const variant = Route.get("variant", "/products/:sku/v/:variant", {
  params: { sku: Schema.String, variant: Schema.String },
  query: { ref: Schema.optionalKey(Schema.String) },
}).pipe(page(React.createElement("span", { "data-page": "variant" }, "variant")));

const article = Route.get("article", "/:locale/blog/:slug", {
  params: {
    locale: Schema.Literals(["en", "de"]),
    slug: Schema.String,
  },
  query: { preview: Schema.optionalKey(Schema.String) },
}).pipe(page(React.createElement("span", { "data-page": "article" }, "article")));

const guide = Route.get("guide", "/docs/:version/:slug", {
  params: {
    version: Schema.Literals(["v1", "v2"]),
    slug: Schema.String,
  },
  query: { q: Schema.optionalKey(Schema.String) },
}).pipe(page(React.createElement("span", { "data-page": "guide" }, "guide")));

const symbol = Route.get("symbol", "/docs/:version/api/:pkg/:name", {
  params: {
    version: Schema.Literals(["v1", "v2"]),
    pkg: Schema.String,
    name: Schema.String,
  },
  query: { src: Schema.optionalKey(Schema.String) },
}).pipe(page(React.createElement("span", { "data-page": "symbol" }, "symbol")));

const acmeContent = [product, variant, article] as const;
const globexContent = [product, article] as const;

const globexDocs = [
  Route.group("docs").add(guide, Route.group("api").add(symbol)),
] as const;

// =============================================================================
// Router catalog — groups FROM Catalog Effect (not Effect→Router)
// =============================================================================

const content = Route.group("content").fromEffect(
  Effect.gen(function* () {
    const catalog = yield* Catalog;
    return catalog._tag === "Storefront" ? acmeContent : globexContent;
  }),
);

export const Site = Router.make("catalog-from-effect")
  .add(Route.get("home", "/"), content)
  .groupsFromEffect(
    Effect.gen(function* () {
      const catalog = yield* Catalog;
      if (catalog._tag !== "DocsPortal") return [] as const;
      return globexDocs;
    }),
  );

export type AcmeUrls = Catalog.Urls<Catalog.Storefront>;
export type GlobexUrls = Catalog.Urls<Catalog.DocsPortal>;

// =============================================================================
// Builder + app Layer
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

export const routesFor = (catalog: Layer.Layer<Catalog>) =>
  pipe(
    RouterBuilder.layer(Site),
    Layer.provide(Layer.mergeAll(home, contentHandlers)),
    Layer.provide(catalog),
  );
