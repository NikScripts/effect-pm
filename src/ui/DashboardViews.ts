/**
 * @module ui/DashboardViews
 *
 * Merged View contribution Layers for the batteries-included Dashboard families
 * (`View.bind` / `only` — no platform TSX). This is the **only** `DashboardViews`
 * namespace; web/TUI implementations live on `hyperlink-ts/web|tui/Dashboard`.
 *
 * ```ts
 * import * as DashboardViews from "hyperlink-ts/ui/DashboardViews"
 * import * as Dashboard from "hyperlink-ts/web/Dashboard"
 *
 * Layer.mergeAll(DashboardViews.layer, appViews).pipe(
 *   Layer.provideMerge(Dashboard.componentsLayer),
 *   Layer.provideMerge(View.base),
 * )
 * // no app contributions: Dashboard.layer
 * ```
 */
import { Layer } from "effect";
import * as ApiMetricsView from "./ApiMetricsView";
import * as DaemonView from "./DaemonView";
import * as FleetHealthView from "./FleetHealthView";
import * as GateView from "./GateView";
import * as GroupView from "./GroupView";
import * as HyperlinkView from "./HyperlinkView";
import * as PriorityView from "./PriorityView";
import * as ShardMapView from "./ShardMapView";
import * as TelemetryView from "./TelemetryView";
import * as WorkPoolView from "./WorkPoolView";

import * as View from "./View";
/**
 * All default Dashboard View contributions (no platform TSX, no {@link ./View.base}).
 *
 * @public
 */
export const layer = Layer.mergeAll(
  GroupView.layer,
  WorkPoolView.layer,
  PriorityView.layer,
  DaemonView.layer,
  ApiMetricsView.layer,
  FleetHealthView.layer,
  TelemetryView.layer,
  ShardMapView.layer,
  GateView.layer,
  HyperlinkView.layer,
);
