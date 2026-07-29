/**
 * @module ui/Bundle
 *
 * @deprecated Prefer `Observe.use(tag, *View.pack)` and {@link ./NodeView.use}.
 * This module remains a thin kind-dispatch shim during migration.
 *
 * @example
 * ```ts
 * import * as Observe from "hyperlink-ts/Observe"
 * import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"
 * const box = Observe.use(Jobs, WorkPoolView.pack)
 * ```
 */
import * as Observe from "../Observe";
import {
  isApiTag,
  isDaemonTag,
  isFleetHealthTag,
  isGateTag,
  isPriorityTag,
  isQueueTag,
  isShardMapTag,
  isTelemetryTag,
  type ApiBundle,
  type ApiTag,
  type DaemonBundle,
  type DaemonTag,
  type FleetHealthBundle,
  type FleetHealthTag,
  type GateBundle,
  type GateTag,
  type NodeBundle,
  type NodeRef,
  type PriorityBundle,
  type PriorityTag,
  type QueueBundle,
  type QueueTag,
  type ShardMapBundle,
  type ShardMapTag,
  type TelemetryBundle,
  type TelemetryTag,
} from "./data";
import * as ApiMetricsView from "./ApiMetricsView";
import * as DaemonView from "./DaemonView";
import * as FleetHealthView from "./FleetHealthView";
import * as GateView from "./GateView";
import * as NodeView from "./NodeView";
import * as PriorityView from "./PriorityView";
import * as ShardMapView from "./ShardMapView";
import * as TelemetryView from "./TelemetryView";
import * as WorkPoolView from "./WorkPoolView";
import { useRuntime, type DataTag } from "./runtime";

export type { DataTag };

/**
 * @deprecated Prefer `Observe.use(tag, *View.pack)`.
 * @public
 */
export function observe(tag: QueueTag): QueueBundle;
export function observe(tag: PriorityTag): PriorityBundle;
export function observe(tag: DaemonTag): DaemonBundle;
export function observe(tag: ApiTag): ApiBundle;
export function observe(tag: FleetHealthTag): FleetHealthBundle;
export function observe(tag: TelemetryTag): TelemetryBundle;
export function observe(tag: ShardMapTag): ShardMapBundle;
export function observe(tag: GateTag): GateBundle;
export function observe(
  tag: DataTag,
):
  | QueueBundle
  | PriorityBundle
  | DaemonBundle
  | ApiBundle
  | FleetHealthBundle
  | TelemetryBundle
  | ShardMapBundle
  | GateBundle;
export function observe(
  tag: DataTag,
):
  | QueueBundle
  | PriorityBundle
  | DaemonBundle
  | ApiBundle
  | FleetHealthBundle
  | TelemetryBundle
  | ShardMapBundle
  | GateBundle {
  if (isQueueTag(tag)) {
    return Observe.use(tag, WorkPoolView.pack);
  }
  if (isPriorityTag(tag)) {
    return Observe.use(tag, PriorityView.pack);
  }
  if (isDaemonTag(tag)) {
    return Observe.use(tag, DaemonView.pack);
  }
  if (isApiTag(tag)) {
    return Observe.use(tag, ApiMetricsView.pack);
  }
  if (isFleetHealthTag(tag)) {
    return Observe.use(tag, FleetHealthView.pack);
  }
  if (isTelemetryTag(tag)) {
    return Observe.use(tag, TelemetryView.pack);
  }
  if (isShardMapTag(tag)) {
    return Observe.use(tag, ShardMapView.pack);
  }
  if (isGateTag(tag)) {
    return Observe.use(tag, GateView.pack);
  }
  throw new Error(`Bundle.observe: no family for tag ${tag.key}`);
}

/**
 * @deprecated Prefer {@link NodeView.use}.
 * @public
 */
export const node = (ref: NodeRef): NodeBundle => NodeView.use(ref);

/**
 * @deprecated Prefer `useRuntime` from `hyperlink-ts/ui`.
 * @public
 */
export const runtime = (): ReturnType<typeof useRuntime> => useRuntime();
