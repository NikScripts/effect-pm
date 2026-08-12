/**
 * @module examples/last/from-effect/cms
 *
 * Type-level CMS tree → narrow URL surface (recursive branches, conditional
 * leaves, path-param bags). Runtime walk feeds `group.fromEffect`.
 */
import { Schema } from "effect";
import * as React from "react";
import * as Route from "last-ts/Route";

// =============================================================================
// CMS AST (const-friendly)
// =============================================================================

/** Leaf — path template + narrow param/query bags (type-level). */
export type CmsLeaf<
  Id extends string = string,
  Path extends Route.Path = Route.Path,
  Params extends { readonly [K in string]: string } = {
    readonly [K in string]: string;
  },
  Query extends { readonly [K in string]: string } = {},
> = {
  readonly _tag: "Leaf";
  readonly id: Id;
  readonly path: Path;
  /** Phantom bag — values unused at runtime; keys/types drive {@link UrlsOf}. */
  readonly params: Params;
  readonly query?: Query | undefined;
};

/** Branch — nested children (finite recursion via the const tree). */
export type CmsBranch<
  Id extends string = string,
  Children extends readonly CmsNode[] = readonly CmsNode[],
> = {
  readonly _tag: "Branch";
  readonly id: Id;
  readonly children: Children;
};

export type CmsNode =
  | CmsLeaf<string, Route.Path, { readonly [K in string]: string }, {
    readonly [K in string]: string;
  }>
  | CmsBranch<string, readonly CmsNode[]>;

// =============================================================================
// Path keys + URL method (mirrors last-ts UrlBuilder, with param bags)
// =============================================================================

type PathKeys<S extends string> = S extends
  `${string}:${infer Key}/${infer Rest}`
  ? Key extends `${infer Name}?` ? readonly [Name, ...PathKeys<Rest>]
  : readonly [Key, ...PathKeys<Rest>]
  : S extends `${string}:${infer Key}`
    ? Key extends `${infer Name}?` ? readonly [Name]
    : readonly [Key]
  : S extends `${string}*${infer Splat}` ? readonly [Splat]
  : readonly [];

type PathArgTupleFromBag<
  Bag extends { readonly [key: string]: string },
  Keys extends readonly string[],
> = {
  [I in keyof Keys]: Keys[I] extends keyof Bag ? Bag[Keys[I] & keyof Bag]
    : string;
};

type QueryOptions<Q extends { readonly [K in string]: string }> = {
  readonly query?: { readonly [K in keyof Q]?: Q[K] | undefined } | undefined;
};

type LeafUrl<L extends CmsLeaf<string, Route.Path, any, any>> = PathKeys<
  L["path"]
> extends readonly [] ? (options?: QueryOptions<NonNullable<L["query"]>>) => string
  : (
    ...args: [
      ...PathArgTupleFromBag<L["params"], PathKeys<L["path"]>>,
      options?: QueryOptions<NonNullable<L["query"]>>,
    ]
  ) => string;

/**
 * Recursive URL surface for a CMS node — branches nest, leaves are methods
 * with **narrow** positional params (from {@link CmsLeaf.params}).
 */
export type UrlsOf<N> = N extends CmsLeaf<string, Route.Path, any, any>
  ? LeafUrl<N>
  : N extends CmsBranch<string, infer Children> ? {
      readonly [
        C in Children[number] as C extends { readonly id: infer Id extends string }
          ? Id
          : never
      ]: UrlsOf<C>;
    }
  : never;

// =============================================================================
// Feature flags → conditional tree (inference from `const` config)
// =============================================================================

export type Locale = "en" | "de";
export type DocVersion = "v1" | "v2";

export type CmsFeatures = {
  readonly variants: boolean;
  readonly docs: boolean;
  readonly locales: readonly Locale[];
};

type ProductLeaf = CmsLeaf<
  "product",
  "/products/:sku",
  { readonly sku: string },
  { readonly ref: string }
>;

type VariantLeaf = CmsLeaf<
  "variant",
  "/products/:sku/v/:variant",
  { readonly sku: string; readonly variant: string },
  { readonly ref: string }
>;

type ArticleLeaf<Locales extends readonly Locale[]> = CmsLeaf<
  "article",
  "/:locale/blog/:slug",
  { readonly locale: Locales[number]; readonly slug: string },
  { readonly preview: string }
>;

type GuideLeaf = CmsLeaf<
  "guide",
  "/docs/:version/:slug",
  { readonly version: DocVersion; readonly slug: string },
  { readonly q: string }
>;

type SymbolLeaf = CmsLeaf<
  "symbol",
  "/docs/:version/api/:pkg/:name",
  {
    readonly version: DocVersion;
    readonly pkg: string;
    readonly name: string;
  },
  { readonly src: string }
>;

type ApiBranch = CmsBranch<"api", readonly [SymbolLeaf]>;
type DocsBranch = CmsBranch<"docs", readonly [GuideLeaf, ApiBranch]>;

type ContentChildren<F extends CmsFeatures> = F["variants"] extends true
  ? readonly [ProductLeaf, VariantLeaf, ArticleLeaf<F["locales"]>]
  : readonly [ProductLeaf, ArticleLeaf<F["locales"]>];

type ContentBranch<F extends CmsFeatures> = CmsBranch<
  "content",
  ContentChildren<F>
>;

/**
 * Full site tree from features — `docs extends true` nests a recursive docs
 * branch (`docs.guide` + `docs.api.symbol`).
 */
export type SiteTree<F extends CmsFeatures> = F["docs"] extends true ?
    | ContentBranch<F>
    | DocsBranch
  : ContentBranch<F>;

/** Nested URL builder for {@link SiteTree}. */
export type SiteUrls<F extends CmsFeatures> = {
  readonly home: () => string;
} & {
  readonly [N in SiteTree<F> as N["id"]]: UrlsOf<N>;
};

// =============================================================================
// Const trees (one per edition) — `satisfies` locks the fancy types
// =============================================================================

const productLeaf = {
  _tag: "Leaf",
  id: "product",
  path: "/products/:sku",
  params: { sku: "" },
  query: { ref: "" },
} as const satisfies ProductLeaf;

const variantLeaf = {
  _tag: "Leaf",
  id: "variant",
  path: "/products/:sku/v/:variant",
  params: { sku: "", variant: "" },
  query: { ref: "" },
} as const satisfies VariantLeaf;

const articleLeaf = {
  _tag: "Leaf",
  id: "article",
  path: "/:locale/blog/:slug",
  params: { locale: "en", slug: "" },
  query: { preview: "" },
} as const satisfies ArticleLeaf<readonly ["en", "de"]>;

const guideLeaf = {
  _tag: "Leaf",
  id: "guide",
  path: "/docs/:version/:slug",
  params: { version: "v1", slug: "" },
  query: { q: "" },
} as const satisfies GuideLeaf;

const symbolLeaf = {
  _tag: "Leaf",
  id: "symbol",
  path: "/docs/:version/api/:pkg/:name",
  params: { version: "v2", pkg: "", name: "" },
  query: { src: "" },
} as const satisfies SymbolLeaf;

/** Storefront — variants on, no docs portal. */
export const storefrontFeatures = {
  variants: true,
  docs: false,
  locales: ["en", "de"],
} as const satisfies CmsFeatures;

/** Docs portal — recursive docs tree, simple PDP. */
export const docsPortalFeatures = {
  variants: false,
  docs: true,
  locales: ["en", "de"],
} as const satisfies CmsFeatures;

export const storefrontContent = {
  _tag: "Branch",
  id: "content",
  children: [productLeaf, variantLeaf, articleLeaf],
} as const satisfies ContentBranch<typeof storefrontFeatures>;

export const docsPortalContent = {
  _tag: "Branch",
  id: "content",
  children: [productLeaf, articleLeaf],
} as const satisfies ContentBranch<typeof docsPortalFeatures>;

export const docsTree = {
  _tag: "Branch",
  id: "docs",
  children: [
    guideLeaf,
    { _tag: "Branch", id: "api", children: [symbolLeaf] } as const,
  ],
} as const satisfies DocsBranch;

// =============================================================================
// Runtime — AST → Route.get (for fromEffect)
// =============================================================================

const localeSchema = Schema.Literals(["en", "de"]);
const versionSchema = Schema.Literals(["v1", "v2"]);

const page = (el: React.ReactElement) => Route.handle(() => el);

/** Typed destinations — ids preserved for `fromEffect` → RouterBuilder. */
export const productRoute = Route.get("product", "/products/:sku", {
  params: { sku: Schema.String },
  query: { ref: Schema.optionalKey(Schema.String) },
}).pipe(
  page(React.createElement("span", { "data-page": "product" }, "product")),
);

export const variantRoute = Route.get("variant", "/products/:sku/v/:variant", {
  params: { sku: Schema.String, variant: Schema.String },
  query: { ref: Schema.optionalKey(Schema.String) },
}).pipe(
  page(React.createElement("span", { "data-page": "variant" }, "variant")),
);

export const articleRoute = Route.get("article", "/:locale/blog/:slug", {
  params: { locale: localeSchema, slug: Schema.String },
  query: { preview: Schema.optionalKey(Schema.String) },
}).pipe(
  page(React.createElement("span", { "data-page": "article" }, "article")),
);

export const guideRoute = Route.get("guide", "/docs/:version/:slug", {
  params: { version: versionSchema, slug: Schema.String },
  query: { q: Schema.optionalKey(Schema.String) },
}).pipe(
  page(React.createElement("span", { "data-page": "guide" }, "guide")),
);

export const symbolRoute = Route.get("symbol", "/docs/:version/api/:pkg/:name", {
  params: {
    version: versionSchema,
    pkg: Schema.String,
    name: Schema.String,
  },
  query: { src: Schema.optionalKey(Schema.String) },
}).pipe(
  page(React.createElement("span", { "data-page": "symbol" }, "symbol")),
);

export const storefrontRoutes = [
  productRoute,
  variantRoute,
  articleRoute,
] as const;

export const docsPortalRoutes = [productRoute, articleRoute] as const;

/** Content destinations for an edition (typed const tuples for `fromEffect`). */
export const contentRoutes = (edition: "storefront" | "docsPortal") =>
  edition === "storefront" ? storefrontRoutes : docsPortalRoutes;

/**
 * Top-level groups from a docs branch — nested `api` stays a real
 * {@link Route.Group} so UrlBuilder nests (`urls.docs.api.symbol`).
 */
export const docsGroups = (_branch: typeof docsTree) =>
  [
    Route.group("docs").add(
      guideRoute,
      Route.group("api").add(symbolRoute),
    ),
  ] as const;