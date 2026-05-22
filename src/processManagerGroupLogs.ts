import { Data, Effect, Stream } from "effect";
import { HttpClient } from "effect/unstable/http";
import {
  decodeProcessManagerLogEntryNdjson,
  type ProcessManagerLogEntry,
} from "./processManagerLogEntry.js";
import { replayLogEntry } from "./processManagerLogRelay.js";

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
}

const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, "")}${path}`;

const logStreamUrl = (controlBaseUrl: string, follow: boolean): string => {
  const url = new URL(joinUrl(controlBaseUrl, "/logs/stream"));
  if (follow) {
    url.searchParams.set("follow", "true");
  }
  return url.toString();
};

const decodeLine = (
  line: string,
): Effect.Effect<ProcessManagerLogEntry, ProcessManagerGroupLogError> =>
  decodeProcessManagerLogEntryNdjson(line).pipe(
    Effect.mapError(
      (error) =>
        new ProcessManagerGroupLogError({
          reason: `Malformed log entry: ${String(error)}`,
        }),
    ),
  );

/**
 * HTTP NDJSON log stream from a group child control plane.
 *
 * @public
 */
export const groupLogEntryStream = (
  options: ProcessManagerGroupLogOptions,
): Stream.Stream<
  ProcessManagerLogEntry,
  ProcessManagerGroupLogError,
  HttpClient.HttpClient
> =>
  Stream.unwrap(
    HttpClient.get(logStreamUrl(options.controlBaseUrl, options.follow)).pipe(
      Effect.mapError(
        (error) =>
          new ProcessManagerGroupLogError({
            reason: `Log stream request failed: ${String(error)}`,
          }),
      ),
      Effect.map((response) =>
        response.stream.pipe(
          Stream.mapError(
            (error) =>
              new ProcessManagerGroupLogError({
                reason: `Log stream body failed: ${String(error)}`,
              }),
          ),
          Stream.decodeText(),
          Stream.splitLines,
          Stream.filter((line) => line.trim().length > 0),
          Stream.mapEffect(decodeLine),
        ),
      ),
    ),
  );

/**
 * Replay group logs through the ambient Effect logger configuration (PM operator).
 *
 * @public
 */
export const streamGroupLogs = (
  options: ProcessManagerGroupLogOptions,
): Effect.Effect<void, ProcessManagerGroupLogError, HttpClient.HttpClient> =>
  groupLogEntryStream(options).pipe(Stream.runForEach((entry) => replayLogEntry(entry)));
