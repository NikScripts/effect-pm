/**
 * @module tui/Dashboard
 *
 * The Ink Group dashboard — terminal counterpart to `<Dashboard runtime group />` from
 * `hyperlink-ts/web`. Stack: `DashboardViews.layer` →
 * `Layer.provideMerge(componentsLayer)` → {@link Views.base} →
 * {@link ../ui/Views.compose} → {@link ./DashboardShell}.
 *
 * ```tsx
 * <Dashboard runtime={Atom.runtime(appLayer)} group={Fleet} />
 * <Dashboard runtime={runtime} group={Fleet} path={["Mail"]} />
 * ```
 *
 *   ↑↓←→ / hjkl  move · Enter/Space open or drill · Esc/Backspace back/up
 *   mouse  wheel scrolls, click selects, click again opens
 *   :  command bar · Ctrl+E edit mode · Ctrl+C quit
 *
 * Ready platform Layer without app contrib: {@link layer}.
 *
 * Heavy eng lives in `../internal/tuiDashboard` (Effect thin-shell mirror).
 */
import * as internal from "../internal/tuiDashboard";

import * as View from "../ui/View";
import * as Views from "../ui/Views";
/**
 * Ink implementations for dashboard View Tags.
 *
 * @public
 */
export const componentsLayer: typeof internal.componentsLayer =
  internal.componentsLayer;

/**
 * Fully provided TUI Dashboard View Layer (`R = never`) — contributions +
 * {@link componentsLayer} + {@link Views.base}. Ready for {@link Views.react}.
 *
 * @public
 */
export const layer: typeof internal.layer = internal.layer;

/**
 * Batteries-included terminal dashboard: registry + Group drill-down.
 * `<Dashboard runtime={Atom.runtime(layer)} group={Fleet} />`.
 *
 * @public
 */
export const Dashboard: typeof internal.Dashboard = internal.Dashboard;
