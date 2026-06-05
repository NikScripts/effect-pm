// @effect-diagnostics strictEffectProvide:off leakingRequirements:off — remote log transport composes RpcClient + Node WebSocket per session.

import { NodeSocket } from "@effect/platform-node";
import { Data, Effect, Layer, Stream } from "effect";
import type { Socket as SocketService } from "effect/unstable/socket/Socket";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import type { ProcessManagerLogEntry } from "../../LogEntry";
import { LogRpc } from "../../LogTransportRpc";
import { logTransport, logTransportWebSocketUrl } from "../../logTransport";
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
 * Effect services required while consuming {@link groupLogEntryStream}.
 *
 * @public
 */
export type ProcessManagerGroupLogRequirements =
  | RpcSerialization.RpcSerialization
  | SocketService;

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

/** @internal */
export const processManagerGroupLogClientLayer = (controlBaseUrl: string) =>
  logTransportClientLayer(logTransportWebSocketUrl(controlBaseUrl));

const logTransportClientLayer = (websocketUrl: string) =>
  Layer.provide(
    RpcClient.layerProtocolSocket(),
    Layer.mergeAll(
      NodeSocket.layerWebSocket(websocketUrl),
      RpcSerialization.layerNdjson,
    ),
  );

const mapLogTransportError = (
  error: unknown,
): ProcessManagerGroupLogError =>
  new ProcessManagerGroupLogError({
    reason: `Log transport stream failed: ${String(error)}`,
  });

const provideWithLogTransportLayer = <A, E, RIn, ROut>(
  step: Effect.Effect<A, E, RIn>,
  layer: Layer.Layer<ROut, E, never>,
): Effect.Effect<A, E, Exclude<RIn, ROut>> =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(layer);
      return yield* Effect.provide(step, context);
    }),
  );

/**
 * Live log stream from a group child control plane via `logTransport`.
 *
 * @public
 */
export const groupLogEntryStream = (
  options: ProcessManagerGroupLogOptions,
): Stream.Stream<
  ProcessManagerLogEntry,
  ProcessManagerGroupLogError,
  ProcessManagerGroupLogRequirements
> => {
  const websocketUrl = logTransportWebSocketUrl(options.controlBaseUrl);
  return Stream.unwrap(
    Effect.scoped(
      Effect.gen(function* () {
        const rpcClient = yield* RpcClient.make(LogRpc);
        const client = logTransport.makeClient(rpcClient);
        return client.stream({
          follow: options.follow,
          preludeLines: options.preludeLines,
        }).pipe(Stream.mapError(mapLogTransportError));
      }).pipe(Effect.provide(logTransportClientLayer(websocketUrl))),
    ),
  );
};

/**
 * Replay group logs through the ambient Effect logger configuration (PM operator).
 *
 * @public
 */
export const streamGroupLogs = (
  options: ProcessManagerGroupLogOptions,
): Effect.Effect<void, ProcessManagerGroupLogError, ProcessManagerGroupLogRequirements> =>
  provideWithLogTransportLayer(
    Stream.runForEach(
      groupLogEntryStream(options),
      (entry) => replayLogEntry(entry),
    ),
    logTransportClientLayer(logTransportWebSocketUrl(options.controlBaseUrl)),
  );
