/**
 * Shared RunResource layer helpers for examples.
 *
 * @module examples/shared/run-resource-layers
 */

import { Layer } from "effect";
import { Store } from "../../src";

/** Provide the baked-in default store bridge at the app root (required by RunResource engines). @public */
export const withDefaultStore = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  layer.pipe(Layer.provideMerge(Store.layerDefaultMemory));
