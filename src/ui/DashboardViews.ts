/**
 * @module ui/DashboardViews
 *
 * Merged View contribution Layers for the batteries-included Dashboard families.
 * Platform packages merge skins + {@link View.base} into a ready `layer` for {@link View.react}.
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
