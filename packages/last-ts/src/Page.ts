/**
 * @module Page
 *
 * File-router page marks — path + Static / Dynamic / Build (+ metadata) — plus
 * live-route bridges {@link Request} / {@link Document} for Outlet trees.
 *
 * ```ts
 * import * as Page from "last-ts/Page"
 *
 * export default Page.static("/about", AboutView, { title: "About" })
 * export default Page.dynamic("/search", SearchView)
 * export default Page.build("/docs/:chapter", ChapterView, {
 *   paths: listChapterSlugs, // Effect
 * })
 * export const layout = Page.layout("/", BookChrome)
 *
 * // In a page Effect / nested component under Router.Outlet:
 * const req = yield* Page.Request
 * yield* (yield* Page.Document).set("Home")
 * const title = Page.useDocument().title
 * ```
 *
 * The file-router reads {@link stampOf} on the default export and maps to the
 * web engine internally (`createPages`). Apps never write Waku `getConfig`.
 */
import type * as React from "react";
import { Data, Effect } from "effect";
import type * as pageServices from "./internal/pageServices";

// =============================================================================
// Render mode (owned PascalCase)
// =============================================================================

/**
 * How the file router registers the page with the web engine.
 * Lowercase wire strings stay inside the Waku/`createPages` adapter.
 *
 * @public
 */
export type Render = Data.TaggedEnum<{
  Static: {};
  Dynamic: {};
  Build: {};
}>;

/**
 * Constructors / `$match` for {@link Render}.
 *
 * @public
 */
export const Render = Data.taggedEnum<Render>();

// =============================================================================
// Stamp
// =============================================================================

/** Brand key on stamped page / layout components. @internal */
export const StampTypeId = "~last-ts/Page/stamp" as const;

/**
 * Metadata + render plan attached to a page module default export.
 *
 * @public
 */
type StampBase = {
  readonly path: "/" | `/${string}`;
  readonly title?: string;
  readonly description?: string;
  /**
   * SSG path args for {@link Render.Build} / param routes.
   * Effect so listing can use FileSystem / services without raw Promises.
   */
  readonly paths?: Effect.Effect<ReadonlyArray<string>>;
};

/**
 * Metadata + render plan attached to a page module default export.
 *
 * @public
 */
export type Stamp = StampBase & {
  readonly render: Render;
};

/** @public */
export type StaticStamp = StampBase & {
  readonly render: ReturnType<typeof Render.Static>;
};

/** @public */
export type DynamicStamp = StampBase & {
  readonly render: ReturnType<typeof Render.Dynamic>;
};

/** @public */
export type BuildStamp = StampBase & {
  readonly render: ReturnType<typeof Render.Build>;
  readonly paths: Effect.Effect<ReadonlyArray<string>>;
};

/**
 * React page / layout component the file router loads.
 *
 * @public
 */
export type Component<P extends object = {}> = (
  props: P,
) => React.ReactElement | null;

type Stamped<C> = C & { readonly [StampTypeId]: Stamp };

const stamp = <C extends Component<any>, S extends Stamp>(
  Comp: C,
  value: S,
): C & { readonly [StampTypeId]: S } => Object.assign(Comp, { [StampTypeId]: value });

/**
 * Read the file-router stamp from a default export (if present).
 *
 * @public
 */
export const stampOf = <S extends Stamp>(
  comp: { readonly [StampTypeId]: S } | object,
): S | undefined => {
  if (StampTypeId in comp) {
    return (comp as { readonly [StampTypeId]: S })[StampTypeId];
  }
  return undefined;
};

/**
 * Whether `u` carries a {@link Stamp}.
 *
 * @public
 */
export const isStamped = (u: unknown): u is Stamped<Component> =>
  typeof u === "function" && StampTypeId in u;

// =============================================================================
// Helpers (camelCase) — path string is the key
// =============================================================================

export type Meta = {
  readonly title?: string;
  readonly description?: string;
};

export type BuildMeta = Meta & {
  readonly paths: Effect.Effect<ReadonlyArray<string>>;
};

/**
 * SSG this path. Fixed routes default to Static when unmarked; spelling it out
 * documents intent.
 *
 * @public
 */
export const static_ = <P extends object>(
  path: Stamp["path"],
  Comp: Component<P>,
  meta?: Meta,
): Component<P> & { readonly [StampTypeId]: StaticStamp } =>
  stamp(Comp, { path, render: Render.Static(), ...meta });

export { static_ as static };

/**
 * SSR every request.
 *
 * @public
 */
export const dynamic = <P extends object>(
  path: Stamp["path"],
  Comp: Component<P>,
  meta?: Meta,
): Component<P> & { readonly [StampTypeId]: DynamicStamp } =>
  stamp(Comp, { path, render: Render.Dynamic(), ...meta });

/**
 * Param / build-time path set — dynamic in DEV, static + {@link BuildMeta.paths}
 * in production (file-router / Vite plugin apply the fork).
 *
 * @public
 */
export const build = <P extends object>(
  path: Stamp["path"],
  Comp: Component<P>,
  meta: BuildMeta,
): Component<P> & { readonly [StampTypeId]: BuildStamp } =>
  stamp(Comp, { path, render: Render.Build(), ...meta });

/**
 * Layout chrome (`_layout`). camelCase helper; a `Layout` class later only if earned.
 *
 * @public
 */
export const layout = (
  path: Stamp["path"],
  Comp: Component<{ readonly children: React.ReactNode }>,
  meta?: Meta,
): Component<{ readonly children: React.ReactNode }> & {
  readonly [StampTypeId]: StaticStamp;
} => stamp(Comp, { path, render: Render.Static(), ...meta });

/**
 * Map a stamp’s render mode for the web engine (internal wire).
 *
 * @internal
 */
export const renderModeOf = (
  stampValue: Stamp,
  options: { readonly dev: boolean },
): "static" | "dynamic" => {
  if (stampValue.render._tag === "Dynamic") return "dynamic";
  if (stampValue.render._tag === "Build" && options.dev) return "dynamic";
  return "static";
};

/**
 * Waku `getConfig` derived from a stamped default export.
 *
 * Until the file-router/`createPages` adapter reads {@link stampOf} directly:
 *
 * ```ts
 * const About = Page.static("/about", () => <h1>About</h1>, { title: "About" })
 * export default About
 * export const getConfig = Page.getConfig(About)
 * ```
 *
 * @public
 */
export const getConfig = (
  stamped: object,
  options?: { readonly dev?: boolean },
): (() => Promise<
  | { readonly render: "static" | "dynamic" }
  | {
      readonly render: "static";
      readonly staticPaths: ReadonlyArray<string>;
    }
>) => {
  const stampValue = stampOf(stamped);
  return async () => {
    const dev =
      options?.dev ??
      (typeof import.meta !== "undefined" &&
        Boolean(
          (import.meta as ImportMeta & { readonly env?: { DEV?: boolean } })
            .env?.DEV,
        ));
    if (stampValue === undefined) {
      return { render: "static" as const };
    }
    const mode = renderModeOf(stampValue, { dev });
    if (
      stampValue.render._tag === "Build" &&
      mode === "static" &&
      stampValue.paths !== undefined
    ) {
      const staticPaths = await Effect.runPromise(stampValue.paths);
      return { render: "static" as const, staticPaths };
    }
    return { render: mode };
  };
};

// =============================================================================
// Live route services (Router.Outlet) — RSC-safe Effect tags
// =============================================================================

/** Matched request bag (`params` / `query` / `pathname` / `href`). @public */
export type RequestValue = pageServices.RequestValue;

/** Document chrome bag (title today). @public */
export type DocumentValue = pageServices.DocumentValue;

/** Effect API for {@link Document}. @public */
export type DocumentApi = pageServices.DocumentApi;

/**
 * Current match (`yield* Page.Request`).
 * React hooks: `import { useRequest, useDocument } from "last-ts/Page/react"`.
 *
 * @public
 */
export {
  Request,
  Document,
} from "./internal/pageServices";
