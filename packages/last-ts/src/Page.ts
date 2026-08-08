/**
 * @module Page
 *
 * File-router **page classes** (HttpApi-shaped) plus live-route bridges
 * {@link Request} / {@link Document} for Outlet trees.
 *
 * ```ts
 * // optional request options first (same bag as Route.get)
 * export default class Chapter extends Page.make({
 *   params: { slug: Schema.Literal("routing", "view-service") },
 * }) {
 *   static Component = (props: Page.Props<Chapter>) => (
 *     <h1>{props.params.slug}</h1>
 *   )
 * }
 *
 * // no options
 * export default class About extends Page.make() {
 *   static Component = () => <h1>About</h1>
 * }
 *
 * // SSG opt-in
 * export default class Home extends Page.static() {
 *   static Component = () => <h1>Home</h1>
 * }
 * ```
 *
 * `Page.make` = dynamic (default). `Page.static` = bake. Not a Service —
 * constructor-shaped like `HttpApi.make` / `Router.make`.
 *
 * File-router extracts {@link optionsOf} / {@link modeOf} from the class.
 * Apps never write Waku `getConfig`.
 *
 * Outlet trees:
 *
 * ```ts
 * const req = yield* Page.Request
 * yield* (yield* Page.Document).set("Home")
 * ```
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
 * How the file router / engine registers the page.
 *
 * @public
 */
export type Mode = "static" | "dynamic";

// =============================================================================
// Page class (HttpApi-shaped)
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
  /** Optional React view; file-router / builders read {@link componentOf}. */
  readonly Component?: Component<PropsFromOptions<Options>>;
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
 * Props for a page class: `Page.Props<typeof Chapter>`.
 *
 * @public
 */
export type Props<P extends AnyPage> = PropsFromOptions<P["options"]>;

/**
 * React page component.
 *
 * @public
 */
export type Component<P extends object = {}> = (
  props: P,
) => React.ReactElement | null;

const pageProto = {
  pipe() {
    // eslint-disable-next-line prefer-rest-params -- pipeArguments-style
    return arguments[0];
  },
};

const makePageClass = <
  const Options extends RequestOptions,
  const M extends Mode,
>(
  options: Options,
  mode: M,
): AnyPage<Options, M> => {
  function PageClass(_: never) {}
  Object.setPrototypeOf(PageClass, pageProto);
  return Object.assign(PageClass, {
    [TypeId]: TypeId,
    options,
    mode,
  }) as unknown as AnyPage<Options, M>;
};

/**
 * Dynamic page class (SSR) — optional request options as the **first** argument.
 *
 * Same options bag as {@link ./Route.get}.
 *
 * @example
 * ```ts
 * class Chapter extends Page.make({
 *   params: { slug: Schema.Literal("routing", "view-service") },
 * }) {}
 *
 * class About extends Page.make() {}
 * ```
 *
 * @public
 */
export const make: {
  <const Options extends RequestOptions>(
    options: Options,
  ): AnyPage<Options, "dynamic">;
  (): AnyPage<RequestOptions, "dynamic">;
} = ((options?: RequestOptions) =>
  makePageClass(options ?? ({} as RequestOptions), "dynamic")) as typeof make;

/**
 * Static page class (SSG bake) — optional request options first.
 *
 * @example
 * ```ts
 * class Home extends Page.static() {}
 * class Chapter extends Page.static({
 *   params: { slug: Schema.Literal("routing", "view-service") },
 * }) {}
 * ```
 *
 * @public
 */
export const static_: {
  <const Options extends RequestOptions>(
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

/** Request options on a page class. @public */
export const optionsOf = <P extends AnyPage>(page: P): P["options"] =>
  page.options;

/** `static` | `dynamic` on a page class. @public */
export const modeOf = <P extends AnyPage>(page: P): P["mode"] => page.mode;

/** `static Component` when present. @public */
export const componentOf = <P extends AnyPage>(
  page: P,
): Component<Props<P>> | undefined =>
  page.Component as Component<Props<P>> | undefined;

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

// =============================================================================
// Deprecated stamp helpers (path + component) — prefer {@link make} classes
// =============================================================================

/** @deprecated Prefer {@link make} / {@link static_} page classes. @internal */
export const StampTypeId = "~last-ts/Page/stamp" as const;

/** @deprecated @internal */
export type Stamp = {
  readonly path: "/" | `/${string}`;
  readonly render: { readonly _tag: "Static" | "Dynamic" | "Build" };
  readonly title?: string;
  readonly description?: string;
  readonly paths?: import("effect/Effect").Effect<ReadonlyArray<string>>;
};

/** @deprecated Prefer {@link isPage}. @public */
export const stampOf = (comp: object): Stamp | undefined => {
  if (StampTypeId in comp) {
    return (comp as { readonly [StampTypeId]: Stamp })[StampTypeId];
  }
  return undefined;
};

/** @deprecated Prefer {@link modeOf}. @internal */
export const renderModeOf = (
  stampValue: Stamp,
  options: { readonly dev: boolean },
): "static" | "dynamic" => {
  if (stampValue.render._tag === "Dynamic") return "dynamic";
  if (stampValue.render._tag === "Build" && options.dev) return "dynamic";
  return "static";
};
