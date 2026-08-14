/**
 * @module Page
 *
 * Page mint (`make` / `static`) + live Outlet bridges (`Request`, `document`).
 * Path comes from the file (`fileRouter`) — never on the mint.
 * SSOT: `docs/handoffs/page-mint-lock.md`.
 *
 * ```ts
 * import * as Page from "last-ts/Page"
 * import * as Document from "last-ts/Document"
 *
 * export class About extends Page.make(
 *   Effect.gen(function* () {
 *     yield* Page.document(Document.title("About"))
 *     return <h1>About</h1>
 *   }),
 * ) {}
 *
 * export const aboutStatic = About.pipe(Route.static)
 * ```
 *
 * Never `yield*` inside `()`. Never `getConfig` / `Page.asDefault`.
 */
import type * as React from "react";
import { Effect } from "effect";
import * as Document from "./Document";
import type * as pageServices from "./internal/pageServices";
import * as pageMint from "./internal/pageMint";
import type {
  ParamsTypeOf,
  QueryTypeOf,
  RequestOptions,
} from "./internal/routeRequest";

export type { RequestOptions } from "./internal/routeRequest";

export type Mode = pageMint.Mode;
export type Default = pageMint.Default;
export type AnyPage<
  Options extends RequestOptions = RequestOptions,
  M extends Mode = Mode,
> = pageMint.AnyPage<Options, M>;

export const TypeId = pageMint.TypeId;
export const isPage = pageMint.isPage;

/**
 * Props derived from a page mint’s request options.
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
 * Props for a page mint (`typeof Chapter`).
 *
 * @public
 */
export type Props<P extends AnyPage> = PropsFromOptions<P["options"]>;

/**
 * React page body (props component).
 *
 * @public
 */
export type Component<P extends object = {}> = (
  props: P,
) => React.ReactElement | null;

/**
 * Dynamic page mint — `Page.make(default)` or `Page.make(options, default)`.
 * Default: JSX element, component, or Effect → ReactNode.
 *
 * @public
 */
export const make = pageMint.make;

/**
 * Static page mint (sugar). To flip an existing page, use `page.pipe(Route.static)`.
 *
 * @public
 */
export const static_: typeof pageMint.static_ = pageMint.static_;

export { static_ as static };

/** @internal — used by `Route.static`. */
export const remintStatic = pageMint.remintStatic;

// =============================================================================
// Live route services (Router.Outlet)
// =============================================================================

/** Matched request bag (`params` / `query` / `pathname` / `href`). @public */
export type RequestValue = pageServices.RequestValue;

/**
 * @deprecated Legacy Outlet bag — prefer {@link document} + `last-ts/Document`.
 * @public
 */
export type DocumentValue = pageServices.DocumentValue;

/**
 * @deprecated Legacy Outlet API — prefer {@link document}.
 * @public
 */
export type DocumentApi = pageServices.DocumentApi;

/**
 * Current match (`yield* Page.Request`).
 * React: `import * as Page from "last-ts/Page/react"` → `Page.useRequest`.
 *
 * @public
 */
export { Request } from "./internal/pageServices";

/**
 * @deprecated Prefer {@link document}. Kept for Outlet bridge.
 * @public
 */
export { Document } from "./internal/pageServices";

/**
 * Merge document-field patches / partials into the current {@link Document.Cell}.
 *
 * Never `yield*` inside `()`.
 *
 * @public
 */
export const document = (
  ...args: Array<unknown>
): Effect.Effect<void, never, Document.Cell> =>
  Document.applyDocumentArgs(...args);

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
