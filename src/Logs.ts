/**
 * Process-manager **capture and relay** — not storage.
 *
 * @remarks
 * - **`captureLoggerLayer`** — hooks Effect `Logger` and publishes structured
 *   {@link ProcessManagerLogEntry} values.
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
  ProcessManagerLogRelay,
  captureLogger,
  captureLoggerLayer,
  layer as relayOnlyLayer,
  replayLogEntry,
  type ProcessManagerLogRelayService,
} from "./internal/manager/logCapture";
import { logsRelayLayer, relayLayer } from "./internal/manager/logPersistRelay";
import { captureLoggerLayer as captureLoggerLayerImpl } from "./internal/manager/logCapture";
import { relayLayer as relayLayerImpl } from "./internal/manager/logPersistRelay";

export {
  ProcessManagerLogRelay,
  captureLogger,
  captureLoggerLayer,
  relayOnlyLayer,
  replayLogEntry,
  type ProcessManagerLogRelayService,
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
 * Capture and relay layers for process-manager logging.
 *
 * @remarks
 * Root imports match {@link Logs} members. Durable history uses
 * {@link LogStore} with `layerProcessStore`.
 *
 * @public
 */
export const Logs = {
  ProcessManagerLogRelay,
  captureLogger,
  captureLoggerLayer,
  relayLayer,
  logsRelayLayer,
  replayLogEntry,
  relayOnlyLayer,
  relayWithCaptureLoggerLayer,
  processManagerLogRelayLayer: relayOnlyLayer,
} as const;
