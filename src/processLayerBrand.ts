import { Layer } from "effect";
import type { PollingTag } from "./Polling.js";
import type { ProcessScheduleTag } from "./ProcessSchedule.js";

/** @internal Marks layers produced by effect-pm polling presets for {@link Process.make} arg parsing. */
export const pollingLayerBrand: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/PollingLayerBrand",
);

/** @internal Marks layers produced by effect-pm schedule presets for {@link Process.make} arg parsing. */
export const scheduleLayerBrand: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/ScheduleLayerBrand",
);

type BrandedLayer<L> = L & {
  readonly [pollingLayerBrand]?: true;
  readonly [scheduleLayerBrand]?: true;
};

/** @internal */
export const brandPollingLayer = <I, E, R>(layer: Layer.Layer<I, E, R>): Layer.Layer<I, E, R> =>
  Object.assign(layer, { [pollingLayerBrand]: true as const });

/** @internal */
export const brandScheduleLayer = <I, E, R>(layer: Layer.Layer<I, E, R>): Layer.Layer<I, E, R> =>
  Object.assign(layer, { [scheduleLayerBrand]: true as const });

const hasBrand = (layer: Layer.Layer<unknown, unknown, unknown>, brand: symbol): boolean =>
  (layer as unknown as BrandedLayer<Layer.Layer<unknown, unknown, unknown>>)[brand as keyof BrandedLayer<
    Layer.Layer<unknown, unknown, unknown>
  >] === true;

/** @internal */
export const isPollingLayer = (u: unknown): u is Layer.Layer<PollingTag, never, never> =>
  Layer.isLayer(u) && hasBrand(u, pollingLayerBrand);

/** @internal */
export const isScheduleLayer = (u: unknown): u is Layer.Layer<ProcessScheduleTag, never, never> =>
  Layer.isLayer(u) && hasBrand(u, scheduleLayerBrand);
