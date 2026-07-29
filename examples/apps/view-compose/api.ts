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
 * - Group helpers: `open` / `up` / `path` / `crumbs` / `openLogs` / …
 * - React: `Provider` / `useRouter` / `Link` / `useMatch` / `useTarget`
 *
 * `up` / `toRoot` **replace**; `go` / `open*` **push**. `back` = stack.
 * Deprecated: `useGroupRoute` → use Router.
 */
export interface StolenRouter {
  readonly pathname: string;
  readonly path: ReadonlyArray<string>;
  readonly crumbs: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly href: string;
  }>;
  readonly open: (member: MemberTag) => void;
  readonly up: () => void;
  readonly back: () => void;
  readonly to: (build: (urls: unknown) => string) => void;
}

/**
 * STEAL W12 — `View.react(layer)` → `{ Provider, Card, Detail, Page, for, groupDash }`.
 * STEAL W20 — `View.group(AppGroup)` stashes group + leaves on the kit.
 * STEAL W21 — skins via `Layer.succeed(View, Comp)` / `View.kind` / `View.only`.
 * STEAL `View.compose({ views, router })` — `router` is `Layer | Service`.
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

// Minimal React namespace so the sketch typechecks without importing react deeply.
declare namespace React {
  type ReactNode = unknown;
  type ReactElement = unknown;
}

// =============================================================================
// WILD — still owner-gated (do not Eng without ask)
// =============================================================================

/**
 * **WILD — Nested outlets / guards / query strings as kit product**
 *
 * Today: flat Outlet + Target view (`logs` / `schedule` / `health`). Nested
 * outlet trees, route guards, and first-class query are not kit surface yet.
 */
export type WildNestedOutlets = never;

/**
 * **WILD — Overlay kinds on the View registry**
 *
 * Steal W8 (`card` | `detail` | `page`). Logs / schedule could become page
 * skins instead of Outlet forks — owner call.
 */
export type WildOverlayKind = "page";

/**
 * **WILD — `View.member` matcher (Group ∪ leaf)**
 *
 * One Grid cell path; Group card is just the Group family's Card skin.
 */
export declare const ViewMember: (props: {
  readonly tag: MemberTag;
  readonly name?: string;
}) => React.ReactElement | null;

/**
 * **WILD — Null / Test view packs**
 *
 * Swappable Layer that succeeds every required View with empty components.
 */
export type WildViewPack = "web" | "tui" | "null";

// =============================================================================
// Recommended Eng order (steal-first)
// =============================================================================

/**
 * 1. ~~Router as Context.Service~~ — STEAL (done on work branch).
 * 2. ~~View.compose thin shell~~ — STEAL (Layer | Service).
 * 3. Group Card as View.Member (Wild) — kill Dashboard Cell fork.
 * 4. Peel DetailScreen → body skins; shell keeps header.
 * 5. Only then: overlay pages / null pack (owner-gated).
 *
 * HOLD hard-delete of public `GroupRoute` / `useGroupRoute` until owner asks.
 */
export const engOrder = [
  "Router-service-STEAL",
  "View.compose-STEAL",
  "group-card-as-View-Member",
  "peel-DetailScreen",
  "overlay-pages",
  "ViewPack.null",
] as const;
