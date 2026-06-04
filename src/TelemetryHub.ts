/**
 * **TelemetryHub** — fan-out router for facet telemetry emits.
 *
 * @remarks
 * Kernel code emits through the hub with `R = TelemetryHub` only. Optional
 * {@link sinkLayer | sink layers} register persist, projection, and broadcast
 * legs at app compose time — emit works with zero sinks and without
 * {@link RuntimeStorage}.
 *
 * @module TelemetryHub
 */

import { Context, Data, Effect, Layer, Ref } from "effect";
import type * as Schema from "effect/Schema";
import { dispatchEmit } from "./internal/telemetryHub/dispatch";
import { TelemetryHubState } from "./internal/telemetryHub/state";

/** Dot-separated telemetry wire id (e.g. `RunResource.State.Changed`). @public */
export type TelemetryWireId = string;

/** Sink failure handling policy. @public */
export type TelemetrySinkPolicy = "persist" | "bestEffort";

/** Decoded event passed to sinks after schema validation. @public */
export interface TelemetryHubEmitted {
  readonly wire: TelemetryWireId;
  readonly payload: unknown;
}

/** Hub emit request — payload validated against `schema` at runtime. @public */
export interface TelemetryHubEmitRequest {
  readonly wire: TelemetryWireId;
  readonly schema: Schema.Codec<any>;
  readonly payload: unknown;
}

/** Registered sink — opt-in via {@link sinkLayer}. @public */
export interface TelemetrySink {
  readonly tag: string;
  readonly wires: ReadonlyArray<TelemetryWireId> | "all";
  readonly policy: TelemetrySinkPolicy;
  readonly handle: (
    event: TelemetryHubEmitted,
  ) => Effect.Effect<void, unknown, never>;
}

/** Sealed event definition for typed emits. @public */
export interface TelemetryEventDefinition<A, I = A> {
  readonly wire: TelemetryWireId;
  readonly schema: Schema.Codec<A, I>;
}

/** @public */
export class TelemetryHubPayloadDecodeError extends Data.TaggedError(
  "TelemetryHubPayloadDecodeError",
)<{
  readonly wire: string;
  readonly error: string;
}> {}

/** @public */
export class TelemetryHubSinkError extends Data.TaggedError("TelemetryHubSinkError")<{
  readonly sink: string;
  readonly wire: string;
  readonly cause: unknown;
}> {}

/** @public */
export type TelemetryHubError =
  | TelemetryHubPayloadDecodeError
  | TelemetryHubSinkError;

/** @public */
export interface TelemetryHubService {
  readonly emit: (
    request: TelemetryHubEmitRequest,
  ) => Effect.Effect<void, TelemetryHubError>;
}

/**
 * Build a dot-separated telemetry wire id.
 *
 * @public
 */
export const telemetryWireId = (
  namespace: string,
  tagPath: ReadonlyArray<string>,
  eventName: string,
): TelemetryWireId => [namespace, ...tagPath, eventName].join(".");

/**
 * Define a hub-routed telemetry event (SSoT for wire + schema).
 *
 * @public
 */
export const defineEvent = <A, I = A>(options: {
  readonly namespace: string;
  readonly tagPath: ReadonlyArray<string>;
  readonly name: string;
  readonly schema: Schema.Codec<A, I>;
}): TelemetryEventDefinition<A, I> => ({
  wire: telemetryWireId(options.namespace, options.tagPath, options.name),
  schema: options.schema,
});

/**
 * Emit a typed event through the hub.
 *
 * @public
 */
export const emit = <A, I>(
  definition: TelemetryEventDefinition<A, I>,
  payload: I,
): Effect.Effect<void, TelemetryHubError, TelemetryHub> =>
  Effect.flatMap(TelemetryHub, (hub) =>
    hub.emit({
      wire: definition.wire,
      schema: definition.schema,
      payload,
    }),
  );

/**
 * Construct a {@link TelemetrySink}.
 *
 * @public
 */
export const sink = (options: {
  readonly tag: string;
  readonly wires: ReadonlyArray<TelemetryWireId> | "all";
  readonly policy?: TelemetrySinkPolicy | undefined;
  readonly handle: (
    event: TelemetryHubEmitted,
  ) => Effect.Effect<void, unknown, never>;
}): TelemetrySink => ({
  tag: options.tag,
  wires: options.wires,
  policy: options.policy ?? "bestEffort",
  handle: options.handle,
});

/** @public */
export class TelemetryHub extends Context.Service<TelemetryHub, TelemetryHubService>()(
  "@nikscripts/effect-pm/TelemetryHub",
) {}

const makeTelemetryHub = Effect.gen(function* () {
  const { sinksRef } = yield* TelemetryHubState;
  return TelemetryHub.of({
    emit: (request) => dispatchEmit(sinksRef, request),
  });
});

/** @internal */
export const layerState: Layer.Layer<TelemetryHubState> = Layer.effect(
  TelemetryHubState,
  Effect.map(Ref.make<ReadonlyArray<TelemetrySink>>([]), (sinksRef) => ({
    sinksRef,
  })),
);

/**
 * Hub core — exposes hub + shared sink registry state.
 *
 * @public
 */
export const baseLayer: Layer.Layer<TelemetryHub | TelemetryHubState> =
  Layer.mergeAll(
    layerState,
    Layer.provide(Layer.effect(TelemetryHub, makeTelemetryHub), layerState),
  );

/** @public */
export const layer: Layer.Layer<TelemetryHub | TelemetryHubState> = baseLayer;

/**
 * Hub with sinks registered at layer construction (preferred for static compose).
 *
 * @public
 */
export const layerWithSinks = (
  sinks: ReadonlyArray<TelemetrySink> = [],
): Layer.Layer<TelemetryHub> =>
  Layer.effect(
    TelemetryHub,
    Effect.map(Ref.make(sinks), (sinksRef) =>
      TelemetryHub.of({
        emit: (request) => dispatchEmit(sinksRef, request),
      }),
    ),
  );

/**
 * Register one sink. Compose with {@link baseLayer} via `Layer.mergeAll`.
 *
 * @public
 */
export const sinkLayer = (
  registered: TelemetrySink,
): Layer.Layer<never, never, TelemetryHubState> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const { sinksRef } = yield* TelemetryHubState;
      yield* Ref.update(sinksRef, (sinks) => [...sinks, registered]);
    }),
  );

/** @public */
export namespace TelemetryHub {
  export type Service = TelemetryHubService;
}
