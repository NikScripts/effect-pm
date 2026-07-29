/**
 * @module examples/apps/view-compose/api
 *
 * **API sketch** for owner review — steal shipped `View` / `Route` / `Router`.
 * Names marked STEAL exist today; WILD items stay owner-gated.
 *
 * Run nothing. Read top-to-bottom.
 */

import type { Layer } from "effect";

// =============================================================================
// STEAL — shipped (Router dream machine)
// =============================================================================

/**
 * STEAL `hyperlink-ts/ui/Route` — HttpApi-shaped **data** catalog:
 * `Route.make` / `group` / `get` / `addHttpApi` / typed `urlBuilder` / `reflect`.
 * `Route.Target` annotation for Group dashboards.
 *
 * ```ts
 * const site = Route.make("site").add(
 *   Route.get("home", "/home"),
 *   Route.group("app").add(Route.get("dashboard", "/app")),
 * )
 * Route.urlBuilder(site).app.dashboard()
 * ```
 */
export type StolenRouteCatalog = "Route.make | group | get | urlBuilder | Target";

/**
 * STEAL `hyperlink-ts/ui/Router` — `Context.Service` over a catalog.
 *
 * - `Router.make(site, "memory"|"history")` — typed `to` / `urls`
 * - `Router.memory` / `Router.history` — Layer (Api **or** Group)
 * - Group helpers: `open` / `up` / `path` / `openLogs` / …
 * - React: `Provider` / `useRouter` / `Link` / `useMatch` / `useTarget`
 *
 * `up` / `toRoot` **replace**; `go` / `open*` **push**. `back` = stack.
 * Gone: `Navigator`, `GroupRoute`, `useGroupRoute`.
 */
export interface StolenRouter {
  readonly pathname: string;
  readonly path: ReadonlyArray<string>;
  readonly open: (member: MemberTag) => void;
  readonly up: () => void;
  readonly back: () => void;
  readonly to: (build: (urls: unknown) => string) => void;
}

/**
 * STEAL `View.compose({ views, router })` — `router` is Layer or live router value.
 *
 * ```ts
 * const ui = View.compose({
 *   views: Layer.mergeAll(View.group(Hub), WebDashboardViews.layer),
 *   router: Router.history(Hub), // or Router.make(site, "memory")
 * })
 *
 * <ui.Provider>
 *   <ui.Grid />
 *   <ui.Outlet />
 * </ui.Provider>
 * ```
 */
export declare const ViewCompose: {
  readonly compose: <E>(options: {
    readonly views: Layer.Layer<unknown, E, never>;
    readonly router: Layer.Layer<unknown> | StolenRouter;
  }) => {
    readonly Provider: (props: {
      readonly children: React.ReactNode;
    }) => React.ReactElement;
    readonly Grid: () => React.ReactElement | null;
    readonly Outlet: () => React.ReactElement | null;
    readonly router: StolenRouter;
    readonly for: (tag: MemberTag) => {
      readonly Card: (props: {
        readonly name?: string;
      }) => React.ReactElement | null;
      readonly Detail: (props: {
        readonly name?: string;
      }) => React.ReactElement | null;
    };
  };
};

/** A navigable member — Group **or** leaf. STEAL `Group.isGroup`. */
export type MemberTag = unknown;

declare namespace React {
  type ReactNode = unknown;
  type ReactElement = unknown;
}

// =============================================================================
// WILD — still owner-gated
// =============================================================================

/** Nested outlets / guards / query strings as kit product. */
export type WildNestedOutlets = never;

/** Overlay kinds on the View registry. */
export type WildOverlayKind = "page";

/** One Grid cell path for Group ∪ leaf. */
export declare const ViewMember: (props: {
  readonly tag: MemberTag;
  readonly name?: string;
}) => React.ReactElement | null;

/** Swappable null/test view packs. */
export type WildViewPack = "web" | "tui" | "null";

export const engOrder = [
  "Router-service-STEAL",
  "View.compose-STEAL",
  "GroupRoute-deleted",
  "group-card-as-View-Member",
  "peel-DetailScreen",
  "overlay-pages",
  "ViewPack.null",
] as const;
