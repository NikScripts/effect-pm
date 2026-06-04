/**
 * @module BroadcastSink
 * @deprecated Import from `@nikscripts/effect-pm/sink/BroadcastSink` instead.
 */

export {
  BroadcastSink,
  TelemetryBroadcast,
  type TelemetryBroadcastService,
} from "./sink/BroadcastSink";

import { BroadcastSink } from "./sink/BroadcastSink";

/** {@link TelemetryBroadcast} service only. */
export const layer = BroadcastSink.layerBroadcast;

/** Hub + broadcast + sink (prefer {@link BroadcastSink.layer}). */
export const hubLayer = BroadcastSink.layer;

export const sinkLayer = BroadcastSink.sinkLayer;
export const forBroadcast = BroadcastSink.forBroadcast;
