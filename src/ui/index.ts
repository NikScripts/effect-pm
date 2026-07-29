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
/** Family observe door — `Bundle.observe(tag)` under RuntimeProvider. */
export * as Bundle from "./Bundle";
/** Shared Group card View handle + contribution Layer (no platform TSX). */
export * as GroupView from "./GroupView";
/** Shared WorkPool View handles + contribution Layer (no platform TSX). */
export * as WorkPoolView from "./WorkPoolView";
/** Merged Dashboard View contribution Layers (no platform TSX). */
export * as DashboardViews from "./DashboardViews";
/** Layer recipe: contributions + skins + View.base for {@link ./View.compose}. */
export * as DashboardLayer from "./DashboardLayer";
/** Provider only — renderers expose a typed `useWidgets` (web cards vs TUI cells). */
export { WidgetsProvider } from "./widgetsContext";
