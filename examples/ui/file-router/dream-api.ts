/**
 * @module examples/ui/file-router/dream-api
 *
 * Teaching sketch of the **Hyperlink-owned file router** page mark — Effect-shaped,
 * same vocabulary as {@link View} Tags / Layers / {@link Route}.
 *
 * ## What problem this solves
 *
 * Waku wants `export const getConfig = () => ({ render, staticPaths })`. We do **not**
 * teach that. Render mode + SSG paths + page metadata are Hyperlink marks the file
 * router reads, then maps internally to `createPages`.
 *
 * ## Three layers (keep them straight)
 *
 * 1. **Page mark** — `View.static` / `.dynamic` / `.build` (camelCase helpers) or a
 *    preferred **page class** (`View.Page.Tag`) with path/render/meta on statics.
 * 2. **Route catalog** — typed urls (`Route.fileRoot` / `fromEffect`) so `urls.chapter("x")`
 *    is a closed builder, not a stringly href.
 * 3. **View skins** — normal `View.provide` + camelCase `layer` / `skins`. Nested UI
 *    Tags inside a page are ordinary DI (`R` stacks on Layers); the page mark itself
 *    is not a Layer factory.
 *
 * ## Render modes (owned PascalCase discriminants)
 *
 * | Mark | Meaning |
 * |------|---------|
 * | `Static` | SSG this path |
 * | `Dynamic` | SSR every request |
 * | `Build` | DEV → dynamic (any slug); production → static + `paths` |
 *
 * Unmarked fixed path → `Static`. Param routes must mark `Build` (+ paths) or `Dynamic`.
 *
 * Run: `pnpm exec tsx examples/ui/file-router/dream-api.ts`
 * Handoff: `docs/handoffs/file-router-prototype.md`
 */
import * as React from "react";
import { Data, Effect, Layer, Schema } from "effect";
import * as Route from "../../../src/ui/Route";
import * as View from "../../../src/ui/View";

// =============================================================================
// Owned vocabulary — PascalCase discriminants (types-and-naming)
// =============================================================================

/**
 * How the file router registers the page with the web engine.
 * Not Waku’s `"static" | "dynamic"` strings in app code — we lowercase only at the wire.
 */
export type PageRender = Data.TaggedEnum<{
  Static: {};
  Dynamic: {};
  Build: {};
}>;

export const PageRender = Data.taggedEnum<PageRender>();

// =============================================================================
// Page stamp — what the file-router loader reads off a default export
// =============================================================================

const PageStampId = "~hyperlink-ts/View/page" as const;

/**
 * Metadata + render plan attached to a page module.
 * Prefer putting this on a {@link View.Page.Tag} class; helpers stamp the same bag
 * onto a bare component for the escape hatch.
 *
 * @internal sketch — lands on View once Eng’d
 */
export type PageStamp = {
  readonly path: `/${string}` | "/";
  readonly render: PageRender;
  readonly title?: string;
  readonly description?: string;
  /**
   * SSG path args for `Build` / param routes — Effect so listing chapters can use
   * FileSystem / services later without a raw Promise in app code.
   */
  readonly paths?: Effect.Effect<ReadonlyArray<string>>;
};

type PageComponent<P extends object = {}> = (
  props: P,
) => React.ReactElement | null;

const stampPage = <C extends PageComponent<any>>(
  Comp: C,
  value: PageStamp,
): C & { readonly [PageStampId]: PageStamp } =>
  Object.assign(Comp, { [PageStampId]: value });

export const pageStampOf = (comp: object): PageStamp | undefined => {
  if (PageStampId in comp) {
    return (comp as Record<typeof PageStampId, PageStamp>)[PageStampId];
  }
  return undefined;
};

// =============================================================================
// View.static / .dynamic / .build / .layout — camelCase helpers (stand-in)
// =============================================================================

/**
 * Stand-in for the public `View` page helpers. Path string is the route key —
 * never a function `name`.
 *
 * @internal sketch
 */
export const viewPage = {
  /**
   * SSG. Fixed routes can omit a mark (default Static); spelling it out documents intent.
   */
  static: <P extends object>(
    path: PageStamp["path"],
    Comp: PageComponent<P>,
    meta?: {
      readonly title?: string;
      readonly description?: string;
    },
  ) =>
    stampPage(Comp, {
      path,
      render: PageRender.Static(),
      ...meta,
    }),

  /** SSR every request. */
  dynamic: <P extends object>(
    path: PageStamp["path"],
    Comp: PageComponent<P>,
    meta?: {
      readonly title?: string;
      readonly description?: string;
    },
  ) =>
    stampPage(Comp, {
      path,
      render: PageRender.Dynamic(),
      ...meta,
    }),

  /**
   * Param / build-time path set — dynamic while developing, static + `paths` in production.
   */
  build: <P extends object>(
    path: PageStamp["path"],
    Comp: PageComponent<P>,
    meta: {
      readonly title?: string;
      readonly description?: string;
      readonly paths: Effect.Effect<ReadonlyArray<string>>;
    },
  ) =>
    stampPage(Comp, {
      path,
      render: PageRender.Build(),
      ...meta,
    }),

  /**
   * Layout chrome (`_layout`). camelCase value until a `View.Layout` class earns Tag semantics.
   */
  layout: (
    path: PageStamp["path"],
    Comp: PageComponent<{ readonly children: React.ReactNode }>,
  ) =>
    stampPage(Comp, {
      path,
      render: PageRender.Static(),
    }),
} as const;

// =============================================================================
// Content SSOT — Effect, not a bare array hidden in getConfig
// =============================================================================

/** Chapter slugs the docs tree can SSG. Real apps: FileSystem / content index. */
export const listChapterSlugs: Effect.Effect<ReadonlyArray<string>> =
  Effect.succeed(["routing", "stores", "view-tag-types"] as const);

// =============================================================================
// Escape hatch — bare components (no class yet)
// =============================================================================

/**
 * Fixed marketing page. Helper makes the Static mark explicit; default would be
 * the same if unmarked.
 */
export const About = viewPage.static(
  "/about",
  (_props: {}) => React.createElement("main", null, "About"),
  { title: "About", description: "Who we are" },
);

/** Search hits the index every request — Dynamic. */
export const Search = viewPage.dynamic(
  "/search",
  (_props: {}) => React.createElement("main", null, "Search"),
  { title: "Search" },
);

// =============================================================================
// Preferred — page class (View.Page.Tag) + nested View.Tag + camelCase layers
// =============================================================================

/**
 * Path params for `/docs/:chapter` — Schema-first like every other Hyperlink edge.
 */
export class ChapterParams extends Schema.Class<ChapterParams>("ChapterParams")(
  {
    chapter: Schema.String,
  },
) {}

/**
 * Nested chrome inside the page — ordinary View Tag (DI), **not** part of the
 * file-router stamp. Provide via `View.provide` on a camelCase `skins` layer.
 */
export class ChapterAside extends View.Tag<
  ChapterAside,
  { readonly chapter: string }
>()("examples/file-router/chapter-aside") {}

/**
 * The page itself — size chrome `Page`, path/render/meta on statics (SSOT).
 *
 * File-router Eng reads `path` / `render` / `paths` / title from this bag.
 * Nested Tags (Aside) stack Layer `R` until `skins` provides them — same story as
 * Dashboard compose, unrelated to SSG mode.
 */
export class DocsChapter extends View.Page.Tag<
  DocsChapter,
  { readonly chapter: string }
>()("examples/file-router/docs-chapter", {
  path: "/docs/:chapter",
  render: "Build",
  title: "Docs",
  description: "Guide chapter",
  paths: listChapterSlugs,
  spec: { kind: "examples/file-router/docs" } as const,
}) {}

/**
 * Skin for the page Tag — camelCase layer binding (types-and-naming).
 * Inside: yield-style DI is Layer provide, not Effect.gen in the component.
 */
export const docsChapterSkins = Layer.mergeAll(
  View.provide(ChapterAside, ({ chapter }) =>
    React.createElement("aside", null, `On this page · ${chapter}`),
  ),
  View.provide(DocsChapter, ({ chapter }) =>
    React.createElement(
      "article",
      null,
      React.createElement("h1", null, chapter),
      // Nested Tag usage once a matcher/kit exists — debt paid by pagesLayer
      React.createElement("p", null, `Chapter: ${chapter}`),
    ),
  ),
);

/**
 * Default export shape the file module would use once `View.build(Tag)` lands:
 * stamp mirrors the class statics so the loader has one read path.
 */
export const DocsChapterPage = viewPage.build(
  "/docs/:chapter",
  (props: { readonly chapter: string }) =>
    React.createElement("article", null, props.chapter),
  {
    title: "Docs",
    description: "Guide chapter",
    paths: listChapterSlugs,
  },
);

// =============================================================================
// Layout
// =============================================================================

export const BookLayout = viewPage.layout("/", (props) =>
  React.createElement("div", { className: "book" }, props.children),
);

// =============================================================================
// Route catalog — typed urls (fileRoot dream); soft-nav stays Router
// =============================================================================

/**
 * Until `Route.fileRoot` ships, the catalog is spelled explicitly — same urls the
 * codegen table will feed. `topLevel: true` flattens builders onto `urls.*`.
 */
export const site = Route.make("fileRouterDream").add(
  Route.group("root", { topLevel: true }).add(
    Route.get("about", "/about"),
    Route.get("search", "/search"),
    Route.get("chapter", "/docs/:chapter").pipe(
      Route.params(ChapterParams),
    ),
  ),
);

export const urls = Route.urlBuilder(site);

/** App pages Layer — still camelCase; merge into compose at the OS edge. */
export const pagesLayer = Layer.mergeAll(docsChapterSkins);

// =============================================================================
// Demo — Effect program (no console.*, no raw promises)
// =============================================================================

const describeStamp = (name: string, comp: object): string => {
  const stamp = pageStampOf(comp);
  if (stamp === undefined) return `${name}: (no stamp)`;
  return `${name}: path=${stamp.path} render=${stamp.render._tag} title=${stamp.title ?? "—"}`;
};

const program = Effect.gen(function* () {
  yield* Effect.logInfo("page marks (file-router stamps)");
  yield* Effect.logInfo(`  ${describeStamp("About", About)}`);
  yield* Effect.logInfo(`  ${describeStamp("Search", Search)}`);
  yield* Effect.logInfo(`  ${describeStamp("DocsChapterPage", DocsChapterPage)}`);
  yield* Effect.logInfo(`  ${describeStamp("BookLayout", BookLayout)}`);

  yield* Effect.logInfo("Build paths (Effect)");
  const slugs = yield* listChapterSlugs;
  yield* Effect.logInfo(`  chapters → ${slugs.join(", ")}`);

  yield* Effect.logInfo("typed urls (catalog)");
  yield* Effect.logInfo(`  ${urls.about()}`);
  yield* Effect.logInfo(`  ${urls.search()}`);
  yield* Effect.logInfo(`  ${urls.chapter("routing")}`);

  yield* Effect.logInfo(
    "layers: pagesLayer is camelCase; skins pay View.Tag R at compose",
  );
  void pagesLayer;
  void DocsChapter;
  void ChapterAside;
});

void Effect.runPromise(
  program.pipe(
    Effect.tap(() => Effect.logInfo("example:file-router dream-api OK")),
  ),
);
