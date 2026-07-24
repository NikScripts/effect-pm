import { Layer } from "effect";
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

/** @internal */
export const isPollingLayer = (u: unknown): u is Layer.Layer<PollingTag, never, never> => {
  const isLayer = (Layer.isLayer as any)(u) as boolean;
  return isLayer && pollingLayerRegistry.has(u as object);
};

/** @internal */
export const isScheduleLayer = (u: unknown): u is Layer.Layer<DaemonScheduleTag, never, never> => {
  const isLayer = (Layer.isLayer as any)(u) as boolean;
  return isLayer && scheduleLayerRegistry.has(u as object);
};
