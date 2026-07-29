/**
 * Family Observe packs — compositional recipes (parity with WorkPoolView.pack).
 * @internal
 */
import type { NodeRef } from "./data";
import { nodeStatusBundle } from "./data";
import { pack as apiPack } from "./apiMetricsViewPack";
import { pack as daemonPack } from "./daemonViewPack";
import { pack as gatePack } from "./gateViewPack";
import {
  fleetHealthPack,
  shardMapPack,
  telemetryPack,
} from "./pollViewPacks";
import { pack as priorityPack } from "./priorityViewPack";

export {
  apiPack,
  daemonPack,
  fleetHealthPack,
  gatePack,
  priorityPack,
  shardMapPack,
  telemetryPack,
};

/**
 * Node observe — NodeRef is not a Hyperlink Tag, so bind/use take the ref directly.
 */
export const nodeBind =
  <R, ER>(runtime: import("effect/unstable/reactivity").Atom.AtomRuntime<R, ER>) =>
  (ref: NodeRef) =>
    nodeStatusBundle(runtime, ref);
