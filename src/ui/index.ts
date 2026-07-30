/**
 * @module ui
 *
 * **Shared dashboard core** for `hyperlink-ts/web` and `hyperlink-ts/tui` — Group path
 * resolve, widget registry, React atom binding, and `*View` observe packs (via
 * `hyperlink-ts/Observe`). Renderers import from here and supply their own chrome.
 *
 * ```ts
 * import * as Route from "hyperlink-ts/ui/Route"
 * import * as Router from "hyperlink-ts/ui/Router"
 * import { RuntimeProvider } from "hyperlink-ts/ui"
 * import * as Observe from "hyperlink-ts/Observe"
 * import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"
 * ```
 *
 */
export * from "./atom-react";
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
/** UI routing toolkit — HttpApi-shaped make/group/get/match/urlBuilder. */
export * as Route from "./Route";
/**
 * Lite runtime navigation over a Route catalog (`make` / `memory` / `history`).
 * Full Waku edition: `import * as Router from "hyperlink-ts/ui/Router/waku"`.
 */
export * as Router from "./Router";
/** Group-tree state and navigation bound to a core Router (either edition). */
export * as GroupNav from "./GroupNav";
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
