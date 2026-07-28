/**
 * @module examples/view-compose-proto/api
 *
 * **API prototype** (not Eng’d) — React utilities composition surface.
 * Steal from shipped `View` / W9–W21 / Dashboard; invent only where noted.
 *
 * This file is a typed sketch for owner review. It deliberately does **not**
 * import the real kit in a way that claims these APIs exist — names below are
 * proposed. When a symbol already ships, the comment says STEAL.
 *
 * Run nothing. Read top-to-bottom.
 */

import type { Layer } from "effect";

// =============================================================================
// STEAL — already locked / shipped (relocation target, not new product)
// =============================================================================

/**
 * STEAL W9 / `View.Chrome` — parent owns navigation; skins only read hints.
 * Today: `{ onBack?, onOpenSchedule?, width?, … }` via `ChromeProvider`.
 *
 * Gap: Group open / leaf open / pin are still ad-hoc Dashboard props, not chrome.
 */
export interface ChromeV1 {
  readonly onBack?: () => void;
  readonly onOpenSchedule?: () => void;
}

/**
 * STEAL W12 — `View.react(layer)` → `{ Provider, Card, Detail, Page, for, groupDash }`.
 * STEAL W20 — `View.group(AppGroup)` stashes group + leaves on the kit.
 * STEAL W21 — skins via `Layer.succeed(View, Comp)` / `View.kind` / `View.only`.
 *
 * Next Eng (not invent): peel DetailScreen chrome so every family Detail is
 * body-only behind ChromeV1; drop Dashboard `isQueueTag` detail forks.
 */

/**
 * STEAL today's `GroupCard` + `Cell` special-case — product shape is right,
 * home is wrong. Group should match like any other family:
 *
 * ```ts
 * // proposed (thin Eng on existing View.match path)
 * Layer.mergeAll(
 *   View.group(ServicesHub),
 *   View.bind(Group.kind, WebGroupCard), // or View.bind(ServicesHub, …) / only
 *   WebDashboardViews.layer,
 * )
 * // then: <ui.Card tag={Wnba} name="Wnba" />  // parent supplies onOpen via chrome
 * ```
 */

// =============================================================================
// PROPOSED — thin composer (adapt Dashboard, don’t kit-product it yet)
// =============================================================================

/**
 * A navigable member — Group **or** leaf. STEAL `memberKindOf` / `Group.isGroup`
 * discrimination; stop forking render on “is group?” outside View.
 */
export type MemberTag = unknown;

/**
 * STEAL React Router memory/history + our `useGroupRoute` — as a **Context
 * service Layer**, same seam as View skins (W13). Not a second nav framework.
 *
 * Shell provides one of these; cards never import History.
 */
export interface Navigator {
  readonly path: ReadonlyArray<string>;
  readonly open: (member: MemberTag) => void;
  readonly back: () => void;
  /** Present location as lineage keys (see wild · LineagePath). */
  readonly lineage: ReadonlyArray<string>;
}

/**
 * Thin Dashboard = merge views + provide navigator (+ optional runtime).
 * Adapt `DashboardView` internals; **HOLD** a big kit `Dashboard` export until
 * this seam is boring.
 *
 * ```ts
 * const ui = View.compose({
 *   views: Layer.mergeAll(View.group(Hub), WebDashboardViews.layer),
 *   navigator: Navigator.memory(Hub),       // or Navigator.history()
 * })
 *
 * <ui.Provider>
 *   <ui.Grid />           // ui.Card per member — Group included
 *   <ui.Outlet />         // Detail | overlays from navigator
 * </ui.Provider>
 * ```
 */
export declare const ViewCompose: {
  readonly compose: <E>(options: {
    readonly views: Layer.Layer<unknown, E, never>;
    readonly navigator: Layer.Layer<Navigator, never, never>;
  }) => {
    readonly Provider: (props: { readonly children: React.ReactNode }) => React.ReactElement;
    readonly Grid: () => React.ReactElement | null;
    readonly Outlet: () => React.ReactElement | null;
    readonly for: (tag: MemberTag) => {
      readonly Card: (props: { readonly name?: string }) => React.ReactElement | null;
      readonly Detail: (props: { readonly name?: string }) => React.ReactElement | null;
    };
  };
};

// Minimal React namespace so the sketch typechecks without importing react types deeply.
declare namespace React {
  type ReactNode = unknown;
  type ReactElement = unknown;
}

// =============================================================================
// WILD API extras — value probes (keep only if they earn a Layer)
// =============================================================================

/**
 * **WILD 1 — `Navigator` as Context.Service (not callback bag)**
 *
 * Why: ChromeV1 callbacks don’t compose (who wins `onOpen`?). A service Layer
 * does — same reason View skins are Layers. Steal Effect DI; invent nothing
 * about URLs.
 *
 * ```ts
 * class Navigator extends Context.Service<Navigator, NavigatorApi>()("…/Navigator") {}
 * Layer.succeed(Navigator, Navigator.memory(Hub))
 * // skin: const nav = useNavigator(); nav.open(tag)
 * ```
 */
export type WildNavigatorService = Navigator;

/**
 * **WILD 2 — LineagePath (wire lineage as the address)**
 *
 * Steal `LogContext` / node status lineage keys. Route identity =
 * `ReadonlyArray<serviceKey>`, not a bespoke URL DSL. `useGroupRoute` already
 * walks Group membership — expose that as `Navigator.lineage` and let crumbs /
 * deep links serialize the same array.
 *
 * Extra value: PiP logs, Soft followers, and HealthBoard already speak lineage;
 * one address space for UI + observe.
 */
export type LineagePath = ReadonlyArray<string>;

/**
 * **WILD 3 — Overlay kinds on the same View registry**
 *
 * Steal W8 (`card` | `detail` | `page`). Today logs / schedule / health are
 * Dashboard-private screens. Register them as View kinds (or `page` skins)
 * so `<ui.Page tag={BoxScoreQueue} />` can be “logs” when chrome says so —
 * or a dedicated `ViewKind = "logs" | "schedule"` if page stays overloaded.
 *
 * Extra value: retire `Dashboard.tsx` special routes without inventing a
 * parallel overlay router.
 *
 * ```ts
 * View.bind(WorkPool.kind, QueueLogsPage, { as: "page" })
 * // navigator.openLogs(tag) → Outlet renders ui.Page
 * ```
 */
export type WildOverlayKind = "page"; // or extend ViewKind later — owner call

/**
 * **WILD 4 — `View.member` matcher (Group ∪ leaf)**
 *
 * One render path for Grid cells. Group card is just the Group family’s Card
 * skin. Kill `Cell`’s `if (group) GroupCard else ui.Card`.
 *
 * ```ts
 * <View.Member tag={member} name={name} />
 * // resolve: Group.isGroup → group card skin; else leaf card skin
 * ```
 *
 * Type gate: `MemberTag` accepted; leaf-only APIs (`for(WorkPool)`) stay narrow.
 */
export declare const ViewMember: (props: {
  readonly tag: MemberTag;
  readonly name?: string;
}) => React.ReactElement | null;

/**
 * **WILD 5 — Data handles on the kit (`atom` channels), not in each skin**
 *
 * Steal planned `Hyperlink.atom` / existing `queueBundle` — kit exposes
 * `ui.data(tag)` that returns the same bundles Dashboard uses. Skins stay
 * dumb TSX; apps can read data without mounting a card.
 *
 * ```ts
 * const ui = View.compose({ views, navigator })
 * const box = ui.data(BoxScoreQueue)   // { status, metrics, logs, … }
 * <ui.for(BoxScoreQueue).Card />
 * ```
 *
 * Extra value: headless tests + non-React adapters share one data path with
 * the View kit (Promise / TanStack lanes later).
 */
export type WildDataKit = {
  readonly data: (tag: MemberTag) => unknown;
};

/**
 * **WILD 6 — Skin packs as swappable Layers (test / headless)**
 *
 * Steal W7 (web vs TUI = different Layer, same handles). Add a **Null** /
 * **Test** pack that succeeds every required View with empty components.
 *
 * ```ts
 * View.react(Layer.mergeAll(View.group(Hub), ViewPack.null, binds))
 * // missing-skin errors stay; behaviour is silent — great for data-only tests
 * ```
 */
export type WildViewPack = "web" | "tui" | "null";

// =============================================================================
// Recommended Eng order (API-shaped, still steal-first)
// =============================================================================

/**
 * 1. Extend `Chrome` with `onOpen(member)` (or land Wild 1 Navigator service).
 * 2. Group family Card skin + `View.Member` (Wild 4) — delete Dashboard Cell fork.
 * 3. Peel DetailScreen → body skins; shell keeps header (STEAL path).
 * 4. `View.compose` thin wrapper over today’s DashboardView (PROPOSED).
 * 5. Only then: overlays as View pages (Wild 3), `ui.data` (Wild 5), null pack (Wild 6).
 *
 * HOLD kit Dashboard product export until 1–4 are boring.
 */
export const engOrder = [
  "chrome-onOpen-or-Navigator",
  "group-card-as-View-Member",
  "peel-DetailScreen",
  "View.compose-thin-shell",
  "overlay-pages",
  "ui.data",
  "ViewPack.null",
] as const;
