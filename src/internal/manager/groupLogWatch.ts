import { Data, Effect, Stream } from "effect";
import type { ProcessManagerLogEntry } from "../../LogEntry";
import { replayLogEntry } from "./logCapture";

/**
 * @public
 */
export class ProcessManagerGroupLogError extends Data.TaggedError(
  "ProcessManagerGroupLogError",
)<{
  readonly reason: string;
}> {}

/**
 * Options for {@link streamGroupLogs}.
 *
 * @public
 */
export interface ProcessManagerGroupLogOptions {
  readonly controlBaseUrl: string;
  readonly follow: boolean;
  /** Recent in-memory lines from relay snapshot (HTTP `lines` query param). */
  readonly preludeLines?: number;
}

/**
 * @internal
 * @deprecated Live log streaming over control HTTP (`GET /logs/stream`) was removed in
 * 0.7.  Use {@link logTransport} on path `/ws/log` instead.
 */
export const groupLogEntryStream = (
  _options: ProcessManagerGroupLogOptions,
): Stream.Stream<ProcessManagerLogEntry, ProcessManagerGroupLogError> =>
  Stream.fail(
    new ProcessManagerGroupLogError({
      reason:
        "GET /logs/stream was removed from the control HTTP surface. " +
        "Use the logTransport WebSocket client on /ws/log instead.",
    }),
  );

/**
 * Replay group logs through the ambient Effect logger configuration (PM operator).
 *
 * @public
 */
export const streamGroupLogs = (
  options: ProcessManagerGroupLogOptions,
): Effect.Effect<void, ProcessManagerGroupLogError> =>
  groupLogEntryStream(options).pipe(Stream.runForEach((entry) => replayLogEntry(entry)));
