/**
 * Process-manager **capture and relay** — not storage.
 *
 * @remarks
 * - **`captureLoggerLayer`** — hooks Effect `Logger` and publishes structured
 *   {@link ProcessManagerLogEntry} values.
 * - **`relayLayer`** — in-memory tail + PubSub for live watch, with batched flush
 *   into {@link ProcessStore.GroupLog} on the composed {@link ProcessStore}.
 *
 * Durable history uses **`ProcessStore.GroupLog`** (`record`, `load`, `query`) with
 * `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`. Do not put relay
 * layers on `ProcessStore`.
 *
 * @module Logs
 */

export {
  ProcessManagerLogRelay,
  captureLogger,
  captureLoggerLayer,
  layer as relayOnlyLayer,
  replayLogEntry,
  type ProcessManagerLogRelayService,
} from "./processManagerLogRelay.js";

export { logsRelayLayer, relayLayer } from "./processManagerLogsRelay.js";
