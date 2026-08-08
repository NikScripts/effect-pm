/**
 * @module Page
 *
 * File-router **page classes** (HttpApi-shaped) plus live-route bridges
 * {@link Request} / {@link Document} for Outlet trees.
 *
 * ```ts
 * // optional request options first (same bag as Route.get)
 * class Chapter extends Page.make({
 *   params: { slug: Schema.Literals(["routing", "view-service"]) },
 * }) {
 *   static Component = (props: Page.Props<typeof Chapter>) => (
 *     <h1>{props.params.slug}</h1>
 *   )
 * }
 * export default Page.asDefault(Chapter)
 *
 * class About extends Page.make() {
 *   static Component = () => <h1>About</h1>
 * }
 * export default Page.asDefault(About)
 *
 * class Home extends Page.static() {
 *   static Component = () => <h1>Home</h1>
 * }
 * export default Page.asDefault(Home)
 * ```
 *
 * `Page.make` = dynamic (default). `Page.static` = bake. Not a Service —
 * constructor-shaped like `HttpApi.make` / `Router.make`.
 *
 * File-router extracts {@link optionsOf} / {@link modeOf} from the class.
 * Do not invent interim `getConfig` bridges (`pageConfig`, `Page.getConfig`).
 * Param SSG / open dynamic may use Waku’s own `getConfig` on that file only
 * (engine wire). Static/dynamic mode is `Page.make` / `Page.static` — not a
 * host `createPages` API.
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
 *   params: { slug: Schema.Literals(["routing", "view-service"]) },
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
 *   params: { slug: Schema.Literals(["routing", "view-service"]) },
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

/**
 * What the file-router / catalog merge reads off a page class.
 *
 * @public
 */
export type Extracted = {
  readonly mode: Mode;
  readonly options: RequestOptions;
  readonly Component: Component<PropsFromOptions<RequestOptions>> | undefined;
};

/** Extract mode + {@link RequestOptions} (+ Component) from a page class. @public */
export const extract = (page: unknown): Extracted | undefined => {
  if (!isPage(page)) return undefined;
  return {
    mode: page.mode,
    options: page.options,
    Component: page.Component as
      | Component<PropsFromOptions<RequestOptions>>
      | undefined,
  };
};

/**
 * Waku fs-router config derived from a page class (apps never author this).
 *
 * - {@link make} → `{ render: "dynamic" }`
 * - {@link static_} without params → `{ render: "static" }`
 * - {@link static_} with `Schema.Literals` params → `{ render: "static", staticPaths }`
 *
 * @public
 */
export type WakuConfig =
  | { readonly render: "dynamic" }
  | {
      readonly render: "static";
      readonly staticPaths?: ReadonlyArray<string | ReadonlyArray<string>>;
    };

const literalsOf = (schema: unknown): ReadonlyArray<string> | undefined => {
  // Schema values are callable objects (`typeof` → "function").
  if (
    (typeof schema === "object" || typeof schema === "function") &&
    schema !== null &&
    "literals" in schema &&
    Array.isArray((schema as { literals: unknown }).literals)
  ) {
    const out: Array<string> = [];
    for (const value of (schema as { literals: ReadonlyArray<unknown> })
      .literals) {
      if (typeof value !== "string") return undefined;
      out.push(value);
    }
    return out;
  }
  return undefined;
};

/**
 * Expand closed `Schema.Literals` param fields into concrete param bags
 * (union-of-bags shape for {@link ./Route.staticFromEffect}).
 *
 * @public
 */
export const paramBagsOf = (
  page: AnyPage,
): ReadonlyArray<{ readonly [key: string]: string }> | undefined => {
  const params = page.options.params;
  if (params === null || typeof params !== "object") return undefined;
  const entries = Object.entries(params as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const keys: Array<string> = [];
  const axes: Array<ReadonlyArray<string>> = [];
  for (const [key, schema] of entries) {
    const lit = literalsOf(schema);
    if (lit === undefined || lit.length === 0) return undefined;
    keys.push(key);
    axes.push(lit);
  }
  let rows: Array<Array<string>> = [[]];
  for (const axis of axes) {
    const next: Array<Array<string>> = [];
    for (const prefix of rows) {
      for (const value of axis) next.push([...prefix, value]);
    }
    rows = next;
  }
  return rows.map((values) => {
    const bag: { [key: string]: string } = {};
    for (let i = 0; i < keys.length; i++) {
      bag[keys[i]!] = values[i]!;
    }
    return bag;
  });
};

/** Waku `staticPaths` from {@link paramBagsOf} (1 key → strings; n → tuples). */
const staticPathsFromBags = (
  bags: ReadonlyArray<{ readonly [key: string]: string }>,
): ReadonlyArray<string | ReadonlyArray<string>> => {
  const keys = Object.keys(bags[0] ?? {});
  if (keys.length === 1) {
    const key = keys[0]!;
    return bags.map((bag) => bag[key]!);
  }
  return bags.map((bag) => keys.map((key) => bag[key]!));
};

/**
 * Derive Waku-shaped `{ render, staticPaths? }` from a page class.
 * For adapters / tests — not an app-facing `getConfig` API.
 *
 * @public
 */
export const configOf = (page: AnyPage): WakuConfig => {
  if (page.mode === "dynamic") return { render: "dynamic" };
  const bags = paramBagsOf(page);
  return bags === undefined
    ? { render: "static" }
    : { render: "static", staticPaths: staticPathsFromBags(bags) };
};

const hostReserved = new Set([
  "path",
  "pathname",
  "href",
  "query",
  "hash",
  "searchParams",
  "children",
  "params",
]);

/**
 * Map host props (Waku: `path` / segment keys / `query` string) into
 * {@link Props}. Pass-through when the host already sends `params`.
 *
 * @internal
 */
const propsFromHost = <P extends AnyPage>(
  page: P,
  raw: Record<string, unknown>,
): Props<P> => {
  if (
    "params" in raw &&
    typeof raw.params === "object" &&
    raw.params !== null
  ) {
    return raw as Props<P>;
  }
  const pathname =
    typeof raw.path === "string"
      ? raw.path
      : typeof raw.pathname === "string"
        ? raw.pathname
        : "";
  const declared =
    page.options.params !== undefined
      ? Object.keys(page.options.params as object)
      : [];
  const params: Record<string, string> = {};
  const keys =
    declared.length > 0
      ? declared
      : Object.keys(raw).filter((k) => !hostReserved.has(k));
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string") params[key] = value;
  }
  const queryRaw = raw.query;
  const query =
    typeof queryRaw === "string"
      ? Object.fromEntries(new URLSearchParams(queryRaw))
      : typeof queryRaw === "object" && queryRaw !== null
        ? queryRaw
        : {};
  return {
    pathname,
    href: pathname,
    params,
    query,
  } as Props<P>;
};

/**
 * Default-export bridge for hosts that need a function component (e.g. Waku
 * fs-router) while keeping the page class brand for {@link extract}.
 *
 * Adapts Waku’s flat segment props into {@link Props} (`params` / `pathname`).
 *
 * ```ts
 * class Home extends Page.static() {
 *   static Component = () => <h1>Home</h1>
 * }
 * export default Page.asDefault(Home)
 * ```
 *
 * @public
 */
export const asDefault = <P extends AnyPage>(
  page: P & { readonly Component: Component<Props<P>> },
): Component<Props<P>> & P => {
  const Comp = (raw: Props<P> | Record<string, unknown>) =>
    page.Component(propsFromHost(page, raw as Record<string, unknown>));
  // Subclass own props omit brand fields inherited from `Page.make()` —
  // stamp them explicitly so {@link isPage} / {@link extract} keep working.
  Object.setPrototypeOf(Comp, Object.getPrototypeOf(page));
  return Object.assign(Comp, {
    [TypeId]: page[TypeId],
    options: page.options,
    mode: page.mode,
    Component: page.Component,
  }) as Component<Props<P>> & P;
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
