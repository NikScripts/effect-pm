import type { Layer } from "effect";
import type { PollingTag } from "./pollingTag";
import type { DaemonScheduleTag } from "./daemonSchedule";

/** @internal */
const pollingLayerRegistry = new WeakMap<object, true>();

/** @internal */
const scheduleLayerRegistry = new WeakMap<object, true>();

/** @internal Register a polling preset layer without mutating the layer value. */
export const registerPollingLayer = <I, E, R>(
  layer: Layer.Layer<I, E, R>,
): Layer.Layer<I, E, R> => {
  pollingLayerRegistry.set(layer, true);
  return layer;
};

/** @internal Register a schedule preset layer without mutating the layer value. */
export const registerScheduleLayer = <I, E, R>(
  layer: Layer.Layer<I, E, R>,
): Layer.Layer<I, E, R> => {
  scheduleLayerRegistry.set(layer, true);
  return layer;
};

const isRegisteredLayer = (u: unknown, registry: WeakMap<object, true>): u is Layer.Layer<never> =>
  (typeof u === "object" || typeof u === "function") && u !== null && registry.has(u);

/** @internal */
export const isPollingLayer = (u: unknown): u is Layer.Layer<PollingTag, never, never> =>
  isRegisteredLayer(u, pollingLayerRegistry);

/** @internal */
export const isScheduleLayer = (u: unknown): u is Layer.Layer<DaemonScheduleTag, never, never> =>
  isRegisteredLayer(u, scheduleLayerRegistry);
