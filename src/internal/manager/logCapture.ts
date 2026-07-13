/**
 * @deprecated Import from `internal/logs/relay` — shim for internal callers during migration.
 *
 * @module internal/manager/logCapture
 * @internal
 */

export {
  LogRelay,
  captureLogger,
  captureLoggerLayer,
  layer,
  relayLayer,
  replayLogEntry,
} from "../logs/relay";

export type { LogRelayService } from "../logs/relay";
