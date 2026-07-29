/**
 * @module ui/Bundle
 *
 * Namespaced UI observe door — `Bundle.observe(tag)` → family `*Bundle`.
 * Thin Tags; free helper (see principles.handles-stay-thin). Canonical path for
 * library Dashboard and apps: builders in {@link ./data} + {@link ./runtime.useRuntime}.
 * Deprecated `use*Bundle` / `ui.data.*` are aliases only.
 *
 * @example
 * ```ts
 * import * as Bundle from "hyperlink-ts/ui/Bundle"
 * const box = Bundle.observe(Jobs) // QueueBundle under RuntimeProvider
 * ```
 */
import {
  apiBundle,
  daemonBundle,
  fleetHealthBundle,
  gateBundle,
  isApiTag,
  isDaemonTag,
  isFleetHealthTag,
  isGateTag,
  isPriorityTag,
  isQueueTag,
  isShardMapTag,
  isTelemetryTag,
  nodeStatusBundle,
  priorityBundle,
  queueBundle,
  shardMapBundle,
  telemetryBundle,
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
import { useRuntime, type DataTag } from "./runtime";

/**
 * Observe / control atoms for a Hyperlink Tag (or node), under {@link RuntimeProvider}.
 *
 * Kind-checked: wrong family throws. This is the public door (not `use*Bundle` / `ui.data`).
 *
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
export function observe(tag: DataTag): QueueBundle | PriorityBundle | DaemonBundle | ApiBundle | FleetHealthBundle | TelemetryBundle | ShardMapBundle | GateBundle;
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
  const rt = useRuntime();
  if (isQueueTag(tag)) return queueBundle(rt, tag);
  if (isPriorityTag(tag)) return priorityBundle(rt, tag);
  if (isDaemonTag(tag)) return daemonBundle(rt, tag);
  if (isApiTag(tag)) return apiBundle(rt, tag);
  if (isFleetHealthTag(tag)) return fleetHealthBundle(rt, tag);
  if (isTelemetryTag(tag)) return telemetryBundle(rt, tag);
  if (isShardMapTag(tag)) return shardMapBundle(rt, tag);
  if (isGateTag(tag)) return gateBundle(rt, tag);
  throw new Error(`Bundle.observe: no family for tag ${tag.key}`);
}

/**
 * Node observe surface (not a Hyperlink Tag kind).
 *
 * @public
 */
export const node = (ref: NodeRef): NodeBundle => nodeStatusBundle(useRuntime(), ref);

/**
 * Underlying `Atom.AtomRuntime` from {@link RuntimeProvider}.
 *
 * @public
 */
export const runtime = (): ReturnType<typeof useRuntime> => useRuntime();
