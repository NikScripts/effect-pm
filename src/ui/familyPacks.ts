/**
 * Family Observe packs for non-queue Views — `packOf` over proven `*Bundle` builders
 * (parity-first). Queue stays compositional in {@link ./workPoolViewPack}.
 * @internal
 */
import * as Observe from "../Observe";
import {
  apiBundle,
  daemonBundle,
  fleetHealthBundle,
  gateBundle,
  nodeStatusBundle,
  priorityBundle,
  shardMapBundle,
  telemetryBundle,
  type ApiTag,
  type DaemonTag,
  type FleetHealthTag,
  type GateTag,
  type NodeRef,
  type PriorityTag,
  type ShardMapTag,
  type TelemetryTag,
} from "./data";

/** @public */
export const priorityPack = Observe.packOf(
  "workpool/priority",
  (ctx) => priorityBundle(ctx.runtime, ctx.tag as PriorityTag),
);

/** @public */
export const daemonPack = Observe.packOf(
  "daemon",
  (ctx) => daemonBundle(ctx.runtime, ctx.tag as DaemonTag),
);

/** @public */
export const apiPack = Observe.packOf(
  "api",
  (ctx) => apiBundle(ctx.runtime, ctx.tag as ApiTag),
);

/** @public */
export const gatePack = Observe.packOf(
  "gate",
  (ctx) => gateBundle(ctx.runtime, ctx.tag as GateTag),
);

/** @public */
export const fleetHealthPack = Observe.packOf(
  "fleetHealth",
  (ctx) => fleetHealthBundle(ctx.runtime, ctx.tag as FleetHealthTag),
);

/** @public */
export const telemetryPack = Observe.packOf(
  "telemetry",
  (ctx) => telemetryBundle(ctx.runtime, ctx.tag as TelemetryTag),
);

/** @public */
export const shardMapPack = Observe.packOf(
  "shardMap",
  (ctx) => shardMapBundle(ctx.runtime, ctx.tag as ShardMapTag),
);

/**
 * Node observe — NodeRef is not a Hyperlink Tag, so bind/use take the ref directly.
 */
export const nodeBind =
  <R, ER>(runtime: import("effect/unstable/reactivity").Atom.AtomRuntime<R, ER>) =>
  (ref: NodeRef) =>
    nodeStatusBundle(runtime, ref);
