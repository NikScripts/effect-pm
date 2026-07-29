/**
 * @module ui/Bundle
 *
 * Namespaced UI observe door — `Bundle.observe(tag)` → family `*Bundle`.
 * Thin Tags; free helper (see principles.handles-stay-thin). Builds on the same
 * `*Bundle(runtime, tag)` memoization as Dashboard. Prefer this over deprecated
 * `use*Bundle` / `ui.data.*` — one public door for library and apps.
 *
 * @example
 * ```ts
 * import * as Bundle from "hyperlink-ts/ui/Bundle"
 * const box = Bundle.observe(Jobs) // QueueBundle under RuntimeProvider
 * ```
 */
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
import {
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
  type DataTag,
} from "./runtime";

/**
 * Observe / control atoms for a Hyperlink Tag (or node), under {@link RuntimeProvider}.
 *
 * Kind-checked: wrong family throws. Prefer this over `ui.data.*` / `useQueueBundle`.
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
  if (isQueueTag(tag)) return useQueueBundle(tag);
  if (isPriorityTag(tag)) return usePriorityBundle(tag);
  if (isDaemonTag(tag)) return useDaemonBundle(tag);
  if (isApiTag(tag)) return useApiBundle(tag);
  if (isFleetHealthTag(tag)) return useFleetHealthBundle(tag);
  if (isTelemetryTag(tag)) return useTelemetryBundle(tag);
  if (isShardMapTag(tag)) return useShardMapBundle(tag);
  if (isGateTag(tag)) return useGateBundle(tag);
  throw new Error(`Bundle.observe: no family for tag ${tag.key}`);
}

/**
 * Node observe surface (not a Hyperlink Tag kind).
 *
 * @public
 */
export const node = (ref: NodeRef): NodeBundle => useNodeBundle(ref);

/**
 * Underlying `Atom.AtomRuntime` from {@link RuntimeProvider}.
 *
 * @public
 */
export const runtime = (): ReturnType<typeof useRuntime> => useRuntime();
