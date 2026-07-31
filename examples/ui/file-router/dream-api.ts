/**
 * @module examples/ui/file-router/dream-api
 *
 * **Sketch** of the locked page/layout mark API (not package exports yet).
 *
 * - Helpers: `View.static` / `View.dynamic` / `View.build` / `View.layout` (camelCase)
 * - Prefer page **class** for metadata; bare component → `View.dynamic` etc.
 * - Layers: camelCase (`skins`, `pagesLayer`, …)
 */

import type * as React from "react";
import { Layer } from "effect";
import * as Route from "../../../src/ui/Route";
import * as View from "../../../src/ui/View";

// =============================================================================
// Stamp helpers (stand-in for future View.static / .dynamic / .build / .layout)
// =============================================================================

const PageStamp = "~hyperlink-ts/View/page" as const;

type PageRender = "Static" | "Dynamic" | "Build";

type PageStampValue = {
  readonly path: string;
  readonly render: PageRender;
  readonly title?: string;
  readonly description?: string;
  readonly paths?: () => ReadonlyArray<string> | Promise<ReadonlyArray<string>>;
};

type PageComponent<P extends object = {}> = (
  props: P,
) => React.ReactElement | null;

const stamp = <C extends PageComponent<any>>(
  Comp: C,
  value: PageStampValue,
): C => Object.assign(Comp, { [PageStamp]: value });

/** @internal sketch — becomes View.static */
const viewStatic = <P extends object>(
  path: string,
  Comp: PageComponent<P>,
  meta?: { readonly title?: string; readonly description?: string },
): PageComponent<P> =>
  stamp(Comp, { path, render: "Static", ...meta });

/** @internal sketch — becomes View.dynamic */
const viewDynamic = <P extends object>(
  path: string,
  Comp: PageComponent<P>,
  meta?: { readonly title?: string; readonly description?: string },
): PageComponent<P> =>
  stamp(Comp, { path, render: "Dynamic", ...meta });

/** @internal sketch — becomes View.build */
const viewBuild = <P extends object>(
  path: string,
  Comp: PageComponent<P>,
  meta: {
    readonly title?: string;
    readonly description?: string;
    readonly paths: () => ReadonlyArray<string> | Promise<ReadonlyArray<string>>;
  },
): PageComponent<P> =>
  stamp(Comp, { path, render: "Build", ...meta });

/** @internal sketch — becomes View.layout */
const viewLayout = (
  path: string,
  Comp: PageComponent<{ readonly children: React.ReactNode }>,
): PageComponent<{ readonly children: React.ReactNode }> =>
  stamp(Comp, { path, render: "Static" });

// How it reads once hung on View:
const ViewPage = {
  static: viewStatic,
  dynamic: viewDynamic,
  build: viewBuild,
  layout: viewLayout,
} as const;

// =============================================================================
// 1) Bare component → View.dynamic / .static / .build
// =============================================================================

export const About = ViewPage.static(
  "/about",
  (_props: {}) => null as unknown as React.ReactElement,
  { title: "About" },
);

export const Search = ViewPage.dynamic(
  "/search",
  (_props: {}) => null as unknown as React.ReactElement,
  { title: "Search" },
);

const chapters = ["routing", "stores"] as const;

export const Chapter = ViewPage.build(
  "/docs/:chapter",
  (_props: { readonly chapter: string }) =>
    null as unknown as React.ReactElement,
  {
    title: "Docs",
    paths: () => [...chapters],
  },
);

// =============================================================================
// 2) Preferred — page class + metadata on statics + camelCase skins layer
// =============================================================================

class DocsChapter extends View.Page.Tag<
  DocsChapter,
  { readonly chapter: string }
>()("app/page/docs-chapter", {
  // Eng: file-router reads these (path / render / paths / title / …)
  path: "/docs/:chapter",
  render: "Build",
  title: "Docs",
  description: "Guide chapter",
  paths: () => [...chapters],
  spec: { kind: "app/page/docs" } as const,
}) {}

export const docsChapterSkins = View.provide(DocsChapter, ({ chapter }) => {
  void chapter;
  return null;
});

// Dream one-liner once Eng’d: export default View.build(DocsChapter)

// =============================================================================
// 3) Layout — View.layout (camelCase); View.Layout class only if earned later
// =============================================================================

export const BookLayout = ViewPage.layout("/", (props) => {
  void props.children;
  return null as unknown as React.ReactElement;
});

// =============================================================================
// 4) Catalog + camelCase app layer
// =============================================================================

export const site = Route.make("app").add(
  // Dream: Route.fileRoot({ dir: "./pages" })
  Route.group("root", { topLevel: true }).add(
    Route.get("about", "/about"),
    Route.get("search", "/search"),
    Route.get("chapter", "/docs/:chapter"),
  ),
);

export const urls = Route.urlBuilder(site);
// urls.about() · urls.search() · urls.chapter("routing")

export const pagesLayer = Layer.mergeAll(docsChapterSkins);

export const pageStampOf = (comp: object): PageStampValue | undefined => {
  if (PageStamp in comp) {
    return (comp as Record<typeof PageStamp, PageStampValue>)[PageStamp];
  }
  return undefined;
};
