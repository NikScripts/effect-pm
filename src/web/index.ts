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
 * Compose escape hatch:
 * `import * as Dashboard from "hyperlink-ts/web/Dashboard"` — `Dashboard.layer` /
 * `Dashboard.componentsLayer` (Effect `layer` / `*Layer` naming). Prefer
 * `Observe.use(tag, *View.pack)` / `NodeView.use`.
 *
 * Peers: `react`, `react-dom`, `recharts`. Styled with Tailwind utility classes + shadcn theme
 * tokens (`@source` + theme wiring in the consuming app).
 *
 */
export * from "../ui";
export * from "./useViewTransition";
export * from "./runtime";
export * from "./widgets";
export type { Widget, WidgetProps } from "./widget-registry";
export { useWidgets } from "./widget-registry";
export { Dashboard, DashboardView } from "./Dashboard";
export { DashboardShell } from "./DashboardShell";
export { DashboardDetailChrome, DashboardTopBar } from "./DashboardTopBar";
export { NodeStatusHost } from "./NodeStatus";
// NodeBar / HealthBoard / NodeDetail also on this barrel via `./widgets`; prefer
// `import { NodeBar, NodeStatusHost, … } from "hyperlink-ts/web"` or
// `import * as NodeStatus from "hyperlink-ts/web/NodeStatus"`.
export { LogBox, LogsPage, SchedulePage } from "./resourcePages";
export * from "./debug-console";
export { cn } from "./cn";
// Layers: `import * as Dashboard from "hyperlink-ts/web/Dashboard"`
// Family skins: `import * as WorkPoolView from "hyperlink-ts/web/WorkPoolView"`.
