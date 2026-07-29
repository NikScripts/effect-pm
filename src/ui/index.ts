/**
 * @module ui
 *
 * **Shared dashboard core** for `hyperlink-ts/web` and `hyperlink-ts/tui` — Group path
 * resolve, widget registry, React atom binding, and `*View` observe packs (via
 * `hyperlink-ts/Observe`). Renderers import from here and supply their own chrome.
 *
 * ```ts
 * import { resolveGroupRoute, forKind, RuntimeProvider } from "hyperlink-ts/ui"
 * import * as Observe from "hyperlink-ts/Observe"
 * import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"
 * ```
 *
 */
export * from "./atom-react";
export * from "./GroupRoute";
/** Legacy Group path resolve (Navigator); route declaration is {@link ./Route}. */
export * as GroupRoute from "./GroupRoute";
export * from "./data";
export * from "./cache";
export * from "./now";
export * from "./memberKind";
export * from "./widgetRegistry";
export {
  type AnyRuntime,
  RuntimeProvider,
  useRuntime,
} from "./runtime";
/** Keyed Spec-based view registry (`View.Tag` / `View.react`) — prefer `import * as View`. */
export * as View from "./View";
/** Parent-owned Group navigation (memory / history) for View compose. */
export * as Navigator from "./Navigator";
/** UI routing toolkit — HttpApi-shaped make/group/get/match/urlBuilder. */
export * as Route from "./Route";
/** Shared Group card View handle + contribution Layer (no platform TSX). */
export * as GroupView from "./GroupView";
/** Shared WorkPool View handles + observe pack (no platform TSX). */
export * as WorkPoolView from "./WorkPoolView";
/** Shared Priority View handles + observe pack. */
export * as PriorityView from "./PriorityView";
/** Shared Daemon View handles + observe pack. */
export * as DaemonView from "./DaemonView";
/** Shared Gate View handles + observe pack. */
export * as GateView from "./GateView";
/** Shared ApiMetrics View handles + observe pack. */
export * as ApiMetricsView from "./ApiMetricsView";
/** Shared FleetHealth View handles + observe pack. */
export * as FleetHealthView from "./FleetHealthView";
/** Shared Telemetry View handles + observe pack. */
export * as TelemetryView from "./TelemetryView";
/** Shared ShardMap View handles + observe pack. */
export * as ShardMapView from "./ShardMapView";
/** Node observe (`NodeView.use` / `.bind`) — NodeRef, not a Tag. */
export * as NodeView from "./NodeView";
/** Merged Dashboard View contribution Layers (no platform TSX). */
export * as DashboardViews from "./DashboardViews";
/** Layer recipe: contributions + skins + View.base for {@link ./View.compose}. */
export * as DashboardLayer from "./DashboardLayer";
/** Provider only — renderers expose a typed `useWidgets` (web cards vs TUI cells). */
export { WidgetsProvider } from "./widgetsContext";
