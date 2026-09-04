/**
 * @module web/Dashboard
 *
 * The batteries-included resource dashboard: point it at a reactive `runtime` (an
 * `Atom.runtime(layer)` over your tags — local engine or `Hyperlink.client` over http) and a
 * root `Group`, and it renders the responsive drill-down. Navigation is URL-backed and
 * animated with view transitions.
 *
 * Stack (Effect-shaped): `DashboardViews.layer` (shared contributions) →
 * `Layer.provideMerge(componentsLayer)` → {@link ../ui/Views.base} →
 * {@link ../ui/Views.compose} → {@link ./DashboardShell}.
 *
 * Use `<Dashboard runtime group />`, or pipe Layers + `Views.compose` + `DashboardShell`.
 * Ready platform Layer without app contrib: {@link layer}.
 *
 * Heavy eng lives in `../internal/webDashboard` (Effect thin-shell mirror).
 */
import * as internal from "../internal/webDashboard";

/**
 * Web TSX implementations for dashboard View Tags.
 *
 * @public
 */
export const componentsLayer: typeof internal.componentsLayer =
  internal.componentsLayer;

/**
 * Fully provided web Dashboard View Layer (`R = never`) — contributions +
 * {@link componentsLayer} + {@link ../ui/Views.base}. Ready for {@link ../ui/Views.react}.
 *
 * @public
 */
export const layer: typeof internal.layer = internal.layer;

/**
 * The drill-down view + its runtime — compose with `RegistryProvider` + `ViewTransitionProvider`
 * yourself, or use `<Dashboard>` which wires all three.
 *
 * @public
 */
export const DashboardView: typeof internal.DashboardView =
  internal.DashboardView;

/**
 * Batteries-included dashboard: providers + the responsive view + the (opt-in) debug console.
 * `<Dashboard runtime={Atom.runtime(layer)} group={ServicesHub} views={appViews} />`.
 *
 * @public
 */
export const Dashboard: typeof internal.Dashboard = internal.Dashboard;
