/**
 * @module Page
 *
 * Live-route bridges {@link Request} / {@link Document} for Outlet trees, plus
 * HttpApi-shaped page class mints ({@link make} / {@link static_}).
 *
 * **Approved teaching shape** — see [`router-httpapi-lock.md`](../../../docs/handoffs/router-httpapi-lock.md)
 * and [`last-ts-api-corrections.md`](../../../docs/handoffs/last-ts-api-corrections.md):
 *
 * ```ts
 * const Chapter = Effect.gen(function* () {
 *   const req = yield* Page.Request
 *   yield* (yield* Page.Document).set(`Chapter ${req.params.chapter}`)
 *   return <h1>{req.params.chapter}</h1>
 * })
 * ```
 *
 * **Rejected / deleted (do not resurrect):** `Page.asDefault`, `static Component`
 * as the app pattern, `modeOf` / `optionsOf` / `extract` / `paramBagsOf` /
 * `configOf`, any `getConfig` / `pageConfig` bridge. Static vs dynamic is owned
 * by our Route/Page API — never Waku `getConfig`.
 */
import type * as React from "react";
import type * as pageServices from "./internal/pageServices";
import type {
  ParamsTypeOf,
  QueryTypeOf,
  RequestOptions,
} from "./internal/routeRequest";

export type { RequestOptions } from "./internal/routeRequest";

// =============================================================================
// Mode
// =============================================================================

/**
 * How a page class records bake vs dynamic (catalog / marks).
 *
 * @public
 */
export type Mode = "static" | "dynamic";

// =============================================================================
// Page class (HttpApi-shaped mint — not the RSC default-export bridge)
// =============================================================================

/** Brand on {@link make} / {@link static_} constructors. @internal */
export const TypeId = "~last-ts/Page" as const;

/**
 * Page class — request options + mode. Extend with {@link make} / {@link static_}.
 *
 * @public
 */
export interface AnyPage<
  out Options extends RequestOptions = RequestOptions,
  out M extends Mode = Mode,
> {
  new(_: never): {};
  readonly [TypeId]: typeof TypeId;
  readonly options: Options;
  readonly mode: M;
}

/**
 * Props derived from a page class’s request options.
 *
 * @public
 */
export type PropsFromOptions<O extends RequestOptions> = {
  readonly pathname: string;
  readonly href: string;
  readonly params: ParamsTypeOf<O>;
  readonly query: QueryTypeOf<O>;
};

/**
 * Props for a page class (`typeof Chapter`).
 *
 * @public
 */
export type Props<P extends AnyPage> = PropsFromOptions<P["options"]>;

/**
 * React page body.
 *
 * @public
 */
export type Component<P extends object = {}> = (
  props: P,
) => React.ReactElement | null;

const makePageClass = <
  Options extends RequestOptions,
  M extends Mode,
>(
  options: Options,
  mode: M,
): AnyPage<Options, M> => {
  class PageClass {
    static readonly [TypeId] = TypeId;
    static readonly options = options;
    static readonly mode = mode;
  }
  return PageClass as unknown as AnyPage<Options, M>;
};

/**
 * Dynamic page class (default) — optional request options first (same bag as
 * {@link ./Route.get}).
 *
 * @public
 */
export const make: {
  <Options extends RequestOptions>(
    options: Options,
  ): AnyPage<Options, "dynamic">;
  (): AnyPage<RequestOptions, "dynamic">;
} = ((options?: RequestOptions) =>
  makePageClass(options ?? ({} as RequestOptions), "dynamic")) as typeof make;

/**
 * Static (SSG) page class — optional request options first.
 *
 * @public
 */
export const static_: {
  <Options extends RequestOptions>(
    options: Options,
  ): AnyPage<Options, "static">;
  (): AnyPage<RequestOptions, "static">;
} = ((options?: RequestOptions) =>
  makePageClass(options ?? ({} as RequestOptions), "static")) as typeof static_;

export { static_ as static };

/** Whether `u` is a {@link make} / {@link static_} page class. @public */
export const isPage = (u: unknown): u is AnyPage =>
  typeof u === "function" &&
  u !== null &&
  TypeId in u &&
  (u as AnyPage)[TypeId] === TypeId;

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
 * Document title: `yield* (yield* Page.Document).set("…")` — expand only via owner lock.
 *
 * @public
 */
export {
  Request,
  Document,
} from "./internal/pageServices";

// =============================================================================
// Deprecated stamp helpers — park; do not grow
// =============================================================================

/** @deprecated @internal */
export const StampTypeId = "~last-ts/Page/stamp" as const;

/** @deprecated @internal */
export type Stamp = {
  readonly path: "/" | `/${string}`;
  readonly render: { readonly _tag: "Static" | "Dynamic" | "Build" };
  readonly title?: string;
  readonly description?: string;
  readonly paths?: import("effect/Effect").Effect<ReadonlyArray<string>>;
};

/** @deprecated @public */
export const stampOf = (comp: object): Stamp | undefined => {
  if (StampTypeId in comp) {
    return (comp as { readonly [StampTypeId]: Stamp })[StampTypeId];
  }
  return undefined;
};

/** @deprecated @internal */
export const renderModeOf = (
  stampValue: Stamp,
  options: { readonly dev: boolean },
): "static" | "dynamic" => {
  if (stampValue.render._tag === "Dynamic") return "dynamic";
  if (stampValue.render._tag === "Build" && options.dev) return "dynamic";
  return "static";
};
