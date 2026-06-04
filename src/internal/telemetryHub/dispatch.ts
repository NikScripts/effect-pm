/**
 * TelemetryHub emit pipeline.
 *
 * @module internal/telemetryHub/dispatch
 * @internal
 */

import { Effect, pipe, Ref } from "effect";
import * as Schema from "effect/Schema";
import type {
  TelemetryHubEmitRequest,
  TelemetryHubEmitted,
  TelemetryHubError,
  TelemetrySink,
  TelemetrySinkPolicy,
} from "../../TelemetryHub";
import {
  TelemetryHubPayloadDecodeError,
  TelemetryHubSinkError,
} from "../../TelemetryHub";

/** @internal */
export const matchesWire = (
  registered: TelemetrySink,
  wire: string,
): boolean =>
  registered.wires === "all" ||
  registered.wires.some((candidate) => candidate === wire);

const sinkFailureMessage = (error: TelemetryHubSinkError): string =>
  `TelemetryHub sink "${error.sink}" failed for wire "${error.wire}"`;

/** @internal */
export const applySinkPolicy = (
  _policy: TelemetrySinkPolicy,
  effect: Effect.Effect<void, TelemetryHubSinkError>,
): Effect.Effect<void, never> =>
  effect.pipe(
    Effect.catch((error: TelemetryHubSinkError) =>
      Effect.logWarning(sinkFailureMessage(error)).pipe(
        Effect.annotateLogs({
          sink: error.sink,
          wire: error.wire,
        }),
      ),
    ),
  );

/** @internal */
export const runSink = (
  registered: TelemetrySink,
  emitted: TelemetryHubEmitted,
): Effect.Effect<void, never> =>
  pipe(
    registered.handle(emitted),
    Effect.mapError(
      (cause) =>
        new TelemetryHubSinkError({
          sink: registered.tag,
          wire: emitted.wire,
          cause,
        }),
    ),
    (effect) => applySinkPolicy(registered.policy, effect),
  );

/** @internal */
export const dispatchEmit = (
  sinksRef: Ref.Ref<ReadonlyArray<TelemetrySink>>,
  request: TelemetryHubEmitRequest,
): Effect.Effect<void, TelemetryHubError> =>
  pipe(
    Schema.decodeUnknownEffect(request.schema)(request.payload),
    Effect.mapError(
      (error) =>
        new TelemetryHubPayloadDecodeError({
          wire: request.wire,
          error: String(error),
        }),
    ),
    Effect.flatMap((payload) =>
      pipe(
        Ref.get(sinksRef),
        Effect.flatMap((sinks) => {
          const emitted: TelemetryHubEmitted = {
            wire: request.wire,
            payload,
          };
          return Effect.forEach(
            sinks.filter((registered) => matchesWire(registered, request.wire)),
            (registered) => runSink(registered, emitted),
            { concurrency: "unbounded", discard: true },
          );
        }),
      ),
    ),
  );
