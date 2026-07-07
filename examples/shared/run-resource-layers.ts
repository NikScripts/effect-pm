/**
 * Shared RunResource layer helpers for examples.
 *
 * @module examples/shared/run-resource-layers
 */

import type { Layer } from "effect";

/** @deprecated RunResource layers already merge the default store; pass the layer through unchanged. */
export const withDefaultStore = <A, E, R>(layer: Layer.Layer<A, E, R>) => layer;
