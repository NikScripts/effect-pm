/**
 * Process-manager **capture and relay** — not storage.
 *
 * @remarks
 * - **`captureLoggerLayer`** — hooks Effect `Logger` and publishes structured
 *   {@link ProcessManagerLogEntry} values.
 * - **`relayLayer`** — in-memory tail + PubSub for live watch, with batched flush
 *   into {@link ProcessStoreLog} on the composed {@link ProcessStore}.
 *
 * Durable history uses **`ProcessStoreLog`** (`record`, `load`, `query`) with
 * `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`. Do not put relay
 * layers on `ProcessStore`.
 *
 * @module Logs
 */

import { Layer } from "effect";

export {
  ProcessManagerLogRelay,
  captureLogger,
  captureLoggerLayer,
  layer as relayOnlyLayer,
  replayLogEntry,
  type ProcessManagerLogRelayService,
} from "./internal/manager/logCapture";

export { logsRelayLayer, relayLayer } from "./internal/manager/logPersistRelay";
import { captureLoggerLayer as captureLoggerLayerImpl } from "./internal/manager/logCapture";
import { relayLayer as relayLayerImpl } from "./internal/manager/logPersistRelay";

/**
 * Composes {@link relayLayer} then {@link captureLoggerLayer} for child runtimes.
 *
 * @public
 */
export const relayWithCaptureLoggerLayer = relayLayerImpl.pipe(
  Layer.provideMerge(captureLoggerLayerImpl),
);
