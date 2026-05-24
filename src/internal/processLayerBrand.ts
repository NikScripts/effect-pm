import { Layer } from "effect";
import type { PollingTag } from "../Polling";
import type { ProcessScheduleTag } from "../ProcessSchedule";

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
export const isPollingLayer = (u: unknown): u is Layer.Layer<PollingTag, never, never> =>
  Layer.isLayer(u) && pollingLayerRegistry.has(u);

/** @internal */
export const isScheduleLayer = (u: unknown): u is Layer.Layer<ProcessScheduleTag, never, never> =>
  Layer.isLayer(u) && scheduleLayerRegistry.has(u);
