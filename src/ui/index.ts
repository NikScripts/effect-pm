/**
 * @module ui
 *
 * **Shared dashboard core** for `hyperlink-ts/web` and `hyperlink-ts/tui` — DOM-free data
 * bundles, Group path resolve, widget registry (`forKind` / `forKey` / `widgetFor`), and the
 * React atom binding. Renderers import from here and supply their own chrome (History vs
 * `path`, DOM vs Ink).
 *
 * ```ts
 * import { queueBundle, resolveGroupRoute, withEntries, forKind } from "hyperlink-ts/ui"
 * import { RegistryProvider, useAtomValue } from "hyperlink-ts/ui"
 * ```
 *
 */
export * from "./atom-react";
export * from "./groupRoute";
export * from "./data";
export * from "./cache";
export * from "./now";
export * from "./memberKind";
export * from "./widgetRegistry";
export {
  type AnyRuntime,
  type DataDoor,
  type DataTag,
  RuntimeProvider,
  data,
  useApiBundle,
  useDaemonBundle,
  useFleetHealthBundle,
  useGateBundle,
  useNodeBundle,
  usePriorityBundle,
  useQueueBundle,
  useRuntime,
  useShardMapBundle,
  useTelemetryBundle,
} from "./runtime";
/** Keyed Spec-based view registry (`View.Tag` / `View.react`) — prefer `import * as View`. */
export * as View from "./View";
/** Parent-owned Group navigation (memory / history) for View compose. */
export * as Navigator from "./Navigator";
/** @deprecated Prefer `Observe.use(tag, *View.pack)` / {@link ./NodeView}. */
export * as Bundle from "./Bundle";
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
