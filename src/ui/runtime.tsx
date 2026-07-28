/**
 * @module ui/runtime
 *
 * Shared reactive runtime context for web + TUI. `<Dashboard>` / compose apps provide
 * `Atom.runtime(layer)` here; {@link data} (and the `use*Bundle` hooks) read it — no
 * parallel atoms, no runtime baked into {@link ./View.compose}.
 */
import * as React from "react";
import type { Effect } from "effect";
import type { Atom } from "effect/unstable/reactivity";
import {
  type ApiBundle,
  type DaemonBundle,
  type FleetHealthBundle,
  type GateBundle,
  type NodeBundle,
  type NodeRef,
  type PriorityBundle,
  type QueueBundle,
  type ShardMapBundle,
  type TelemetryBundle,
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
} from "./data";

/**
 * Erased Atom runtime — React context can't be generic over the consumer's `R`.
 *
 * @public
 */
export type AnyRuntime = Atom.AtomRuntime<any, any>;

const RuntimeContext = React.createContext<AnyRuntime | null>(null);

/**
 * Provide the reactive runtime to the dashboard / compose subtree.
 *
 * @public
 */
export const RuntimeProvider = <R, E = never>(props: {
  readonly runtime: Atom.AtomRuntime<R, E>;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(
    RuntimeContext.Provider,
    // Context is erased to {@link AnyRuntime}; keep the call-site runtime typed.
    { value: props.runtime as AnyRuntime },
    props.children,
  );

/**
 * Reactive runtime from context (throws if no {@link RuntimeProvider} above).
 *
 * @public
 */
export const useRuntime = (): AnyRuntime => {
  const rt = React.useContext(RuntimeContext);
  if (rt === null) {
    throw new Error(
      "useRuntime: wrap the tree in <RuntimeProvider runtime={…}> (or <Dashboard>)",
    );
  }
  return rt;
};

/**
 * Class handle or narrowed tag — `key` + yieldable Effect (R from the runtime layer).
 *
 * @public
 */
export type DataTag = {
  readonly key: string;
} & Effect.Effect<unknown, unknown, unknown>;

/** Atom bundle for a queue tag, memoized per runtime+tag. @public */
export const useQueueBundle = (tag: DataTag): QueueBundle => {
  if (!isQueueTag(tag)) {
    throw new Error(`View.data.queue: tag ${tag.key} is not a queue tag`);
  }
  return queueBundle(useRuntime(), tag);
};

/** Atom bundle for a `WorkPool.priority` tag. @public */
export const usePriorityBundle = (tag: DataTag): PriorityBundle => {
  if (!isPriorityTag(tag)) {
    throw new Error(`View.data.priority: tag ${tag.key} is not a priority tag`);
  }
  return priorityBundle(useRuntime(), tag);
};

/** Atom bundle for a fleet-health tag. @public */
export const useFleetHealthBundle = (tag: DataTag): FleetHealthBundle => {
  if (!isFleetHealthTag(tag)) {
    throw new Error(
      `View.data.fleetHealth: tag ${tag.key} is not a fleet-health tag`,
    );
  }
  return fleetHealthBundle(useRuntime(), tag);
};

/** Atom bundle for a telemetry tag. @public */
export const useTelemetryBundle = (tag: DataTag): TelemetryBundle => {
  if (!isTelemetryTag(tag)) {
    throw new Error(
      `View.data.telemetry: tag ${tag.key} is not a telemetry tag`,
    );
  }
  return telemetryBundle(useRuntime(), tag);
};

/** Atom bundle for a shard-map tag. @public */
export const useShardMapBundle = (tag: DataTag): ShardMapBundle => {
  if (!isShardMapTag(tag)) {
    throw new Error(`View.data.shardMap: tag ${tag.key} is not a shard-map tag`);
  }
  return shardMapBundle(useRuntime(), tag);
};

/** Atom bundle for a Gate tag. @public */
export const useGateBundle = (tag: DataTag): GateBundle => {
  if (!isGateTag(tag)) {
    throw new Error(`View.data.gate: tag ${tag.key} is not a gate tag`);
  }
  return gateBundle(useRuntime(), tag);
};

/** Atom bundle for a daemon tag. @public */
export const useDaemonBundle = (tag: DataTag): DaemonBundle => {
  if (!isDaemonTag(tag)) {
    throw new Error(`View.data.daemon: tag ${tag.key} is not a daemon tag`);
  }
  return daemonBundle(useRuntime(), tag);
};

/** Atom bundle for an HttpApiClient / API tag. @public */
export const useApiBundle = (tag: DataTag): ApiBundle => {
  if (!isApiTag(tag)) {
    throw new Error(`View.data.api: tag ${tag.key} is not an api tag`);
  }
  return apiBundle(useRuntime(), tag);
};

/** Atom bundle for a node's status. @public */
export const useNodeBundle = (ref: NodeRef): NodeBundle =>
  nodeStatusBundle(useRuntime(), ref);

/**
 * Compose / kit **data door** — same `*Bundle(runtime, tag)` builders as Dashboard.
 *
 * Call during render (hooks): reads {@link RuntimeProvider}.
 *
 * @example
 * ```tsx
 * const ui = View.compose({ views, navigator })
 * function Card() {
 *   const box = ui.data.queue(Jobs)
 *   const st = useAtomValue(box.status)
 *   …
 * }
 * ```
 *
 * @public
 */
export type DataDoor = {
  readonly queue: typeof useQueueBundle;
  readonly priority: typeof usePriorityBundle;
  readonly daemon: typeof useDaemonBundle;
  readonly api: typeof useApiBundle;
  readonly fleetHealth: typeof useFleetHealthBundle;
  readonly telemetry: typeof useTelemetryBundle;
  readonly shardMap: typeof useShardMapBundle;
  readonly gate: typeof useGateBundle;
  readonly node: typeof useNodeBundle;
  readonly runtime: typeof useRuntime;
};

/**
 * Shared data door (also on {@link ./View.compose}`().data`).
 *
 * @public
 */
export const data: DataDoor = {
  queue: useQueueBundle,
  priority: usePriorityBundle,
  daemon: useDaemonBundle,
  api: useApiBundle,
  fleetHealth: useFleetHealthBundle,
  telemetry: useTelemetryBundle,
  shardMap: useShardMapBundle,
  gate: useGateBundle,
  node: useNodeBundle,
  runtime: useRuntime,
};
