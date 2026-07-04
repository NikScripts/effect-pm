/**
 * Process-manager **capture and relay** — not storage.
 *
 * @remarks
 * - **`captureLoggerLayer`** — hooks Effect `Logger` and publishes structured
 *   {@link LogEntry} values.
 * - **`relayLayer`** — in-memory tail + PubSub for live watch, with batched flush
 *   into {@link LogStore} on the composed {@link ProcessStore}.
 *
 * Durable history uses **`LogStore`** (`record`, `load`, `query`) with
 * `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`. Do not put relay
 * layers on `ProcessStore`.
 *
 * @module Logs
 */

import { Layer } from "effect";
import {
  LogRelay,
  captureLogger,
  captureLoggerLayer,
  layer as relayOnlyLayer,
  replayLogEntry,
  type LogRelayService,
} from "./internal/manager/logCapture";
import { logsRelayLayer, relayLayer } from "./internal/manager/logPersistRelay";
import { captureLoggerLayer as captureLoggerLayerImpl } from "./internal/manager/logCapture";
import { relayLayer as relayLayerImpl } from "./internal/manager/logPersistRelay";

export {
  LogRelay,
  captureLogger,
  captureLoggerLayer,
  relayOnlyLayer,
  replayLogEntry,
  type LogRelayService,
};

export { logsRelayLayer, relayLayer };

/**
 * Composes {@link relayLayer} then {@link captureLoggerLayer} for child runtimes.
 *
 * @public
 */
export const relayWithCaptureLoggerLayer = relayLayerImpl.pipe(
  Layer.provideMerge(captureLoggerLayerImpl),
);

/**
 * Relay-only capture layer, aliased for discoverability alongside
 * {@link relayWithCaptureLoggerLayer}.
 *
 * @public
 */
export { relayOnlyLayer as logRelayLayer };
