/**
 * @module web
 *
 * **The HyperService dashboard for the browser** — the web renderer over the shared
 * `hyperlink-ts/ui` core (data bundles + group route + widget registry). Point
 * `<Dashboard runtime group />` at a reactive `runtime` and a root `Group`, and it renders
 * the responsive drill-down: WorkPool / Daemon / subgroup cards, a styled detail per
 * HyperService (stats + chart + controls + logs), and a routed fullscreen log viewer —
 * URL-backed navigation with view-transition animations.
 *
 * ```tsx
 * import { Dashboard } from "hyperlink-ts/web";
 * import { Atom } from "effect/unstable/reactivity";
 * const runtime = Atom.runtime(appLayer); // appLayer: Hyperlink.client(...) over http
 * <Dashboard runtime={runtime} group={ServicesHub} />
 * ```
 *
 * Or compose the pieces: `DashboardLayer.forCompose` + `View.compose` + `DashboardShell`
 * under `RegistryProvider` + `RuntimeProvider` + `ViewTransitionProvider`. Prefer
 * `Observe.use(tag, *View.pack)` / `NodeView.use`.
 *
 * Peers: `react`, `react-dom`, `recharts`. Styled with Tailwind utility classes + shadcn theme
 * tokens (`@source` + theme wiring in the consuming app).
 *
 */
export * from "../ui";
export * from "./useViewTransition";
export * from "./useGroupRoute";
export * from "./runtime";
export * from "./widgets";
export type { Widget, WidgetProps } from "./widget-registry";
export { useWidgets } from "./widget-registry";
export * from "./Dashboard";
export { DashboardShell } from "./DashboardShell";
export { DashboardDetailChrome, DashboardTopBar } from "./DashboardTopBar";
export { NodeStatusHost } from "./NodeStatus";
// NodeBar / HealthBoard / NodeDetail also on this barrel via `./widgets`; prefer
// `import { NodeBar, NodeStatusHost, … } from "hyperlink-ts/web"` or
// `import * as NodeStatus from "hyperlink-ts/web/NodeStatus"`.
export * from "./debug-console";
export { cn } from "./cn";
// Platform skins: `import * as WorkPoolView from "hyperlink-ts/web/WorkPoolView"`
// / `import * as DashboardViews from "hyperlink-ts/web/DashboardViews"`
// (not re-exported here — would clash with `hyperlink-ts/ui` handles).
