/**
 * @module web/runtime
 *
 * Provides the reactive `runtime` (an `Atom.runtime(layer)` over the consumer's tags) to the
 * dashboard tree via context, so deep widgets can build their atom bundles without
 * prop-drilling. `<Dashboard>` sets this up for you; compose it yourself with `RuntimeProvider`.
 */
import * as React from "react";
import type { Atom } from "effect/unstable/reactivity";
import {
  type ApiBundle,
  type ApiTag,
  type CustomQueueBundle,
  type CustomQueueTag,
  type FleetHealthBundle,
  type FleetHealthTag,
  type TelemetryBundle,
  type TelemetryTag,
  type ShardMapBundle,
  type ShardMapTag,
  type RunBundle,
  type RunTag,
  type NodeBundle,
  type NodeRef,
  type DaemonBundle,
  type DaemonTag,
  type QueueBundle,
  type QueueTag,
  apiBundle,
  customQueueBundle,
  fleetHealthBundle,
  telemetryBundle,
  shardMapBundle,
  runBundle,
  nodeStatusBundle,
  daemonBundle,
  queueBundle,
} from "./data";

// The injected runtime's requirement `R` varies per consumer; React context can't be generic,
// so this single seam erases it. `<Dashboard runtime={...} />` keeps the consumer-facing type.
type AnyRuntime = Atom.AtomRuntime<any, any>;

const RuntimeContext = React.createContext<AnyRuntime | null>(null);

/** Provide the reactive runtime to the dashboard subtree. @public */
export const RuntimeProvider = (props: {
  readonly runtime: AnyRuntime;
  readonly children: React.ReactNode;
}): React.ReactElement => <RuntimeContext.Provider value={props.runtime}>{props.children}</RuntimeContext.Provider>;

/** The reactive runtime from context (throws if no `RuntimeProvider`/`Dashboard` above). @public */
export const useRuntime = (): AnyRuntime => {
  const rt = React.useContext(RuntimeContext);
  if (rt === null) throw new Error("useRuntime: wrap the dashboard in <RuntimeProvider> (or use <Dashboard>)");
  return rt;
};

/** Atom bundle for a queue tag, memoized per runtime+tag. @public */
export const useQueueBundle = (tag: QueueTag): QueueBundle => queueBundle(useRuntime(), tag);

/** Atom bundle for a custom-queue tag, memoized per runtime+tag. @public */
export const useCustomQueueBundle = (tag: CustomQueueTag): CustomQueueBundle =>
  customQueueBundle(useRuntime(), tag);

/** Atom bundle for a fleet-health tag, memoized per runtime+tag. @public */
export const useFleetHealthBundle = (tag: FleetHealthTag): FleetHealthBundle =>
  fleetHealthBundle(useRuntime(), tag);

/** Atom bundle for a telemetry tag, memoized per runtime+tag. @public */
export const useTelemetryBundle = (tag: TelemetryTag): TelemetryBundle =>
  telemetryBundle(useRuntime(), tag);

/** Atom bundle for a shard-map tag, memoized per runtime+tag. @public */
export const useShardMapBundle = (tag: ShardMapTag): ShardMapBundle =>
  shardMapBundle(useRuntime(), tag);

/** Atom bundle for a run-gate tag, memoized per runtime+tag. @public */
export const useRunBundle = (tag: RunTag): RunBundle =>
  runBundle(useRuntime(), tag);

/** Atom bundle for a process tag, memoized per runtime+tag. @public */
export const useDaemonBundle = (tag: DaemonTag): DaemonBundle => daemonBundle(useRuntime(), tag);

/** Atom bundle for an API-metrics tag, memoized per runtime+tag. @public */
export const useApiBundle = (tag: ApiTag): ApiBundle => apiBundle(useRuntime(), tag);

/** Atom bundle for a node's status, memoized per runtime+node. @public */
export const useNodeBundle = (ref: NodeRef): NodeBundle => nodeStatusBundle(useRuntime(), ref);
