/**
 * RunResource domain service — tag, public types, and the {@link RunResourceApi}
 * shape. **No kernel import at top level** (one-way dependency: `kernel.ts`
 * imports this module, never the reverse).
 *
 * The concrete factory implementations live in
 * {@link ../runResource/kernel | `kernel.ts`}, which attaches them as statics on
 * {@link RunResource} and provides them via `runResourceLayer`.
 *
 * @module internal/runResource/service
 * @internal
 */

import { Context, Effect, Layer } from "effect";
import type { ConfigPatch } from "../../ResourceConfigure";
import type {
  RunResourceFact,
  RunResourceFactType,
  RunResourceRunCompletedFact,
  RunResourceRunCompletedPayload,
  RunResourceRunFailedFact,
  RunResourceRunFailedPayload,
  RunResourceRunStartedFact,
  RunResourceRunStartedPayload,
  RunResourceState,
  RunResourceStateChange,
  RunResourceStateChangeReason,
} from "../../store/RunResource";
import type { TelemetryHubError, TelemetryRouter } from "../../TelemetryRouter";

// ============================================================================
// Public Types
// ============================================================================

/**
 * A gated callable produced by {@link RunResourceApi.make}.
 *
 * Call it with the input to execute the effect through the concurrency gate.
 *
 * @typeParam T - Input type
 * @typeParam A - Success type
 * @typeParam E - Error type
 *
 * @public
 */
export interface RunGate<in T, out A, out E> {
  (input: T): Effect.Effect<A, E | TelemetryHubError, TelemetryRouter>;
}

/** @public */
export interface RunResourceMetadata<Id extends string, T, A, E = never> {
  readonly id: Id;
  readonly kind: "RunResource";
  readonly tag: Context.Service<Id, RunGate<T, A, E>>;
}

/** @public */
export type RunResourceDefinition<
  Id extends string,
  T,
  A,
  E = never,
> = Context.Service<Id, RunGate<T, A, E>> &
  RunResourceMetadata<Id, T, A, E>;

/**
 * A generic runner that wraps any effect with concurrency gating.
 * Produced by {@link RunResourceApi.makeRunner}.
 *
 * @public
 */
export interface RunResourceRunner {
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
}

/**
 * Configuration for {@link RunResourceApi.make} and {@link RunResourceApi.Service}.
 *
 * @typeParam T - Input type (void for unit effects)
 * @typeParam A - Success type
 * @typeParam E - Error type
 *
 * @public
 */
export interface RunResourceConfig<T, A, E> {
  /** Service name used for log annotations. */
  readonly name?: string;
  /**
   * The effect to gate. A function receiving the input and returning the effect.
   * For unit gates (no input), use `() => myEffect`.
   */
  readonly effect: (input: T) => Effect.Effect<A, E>;
  /**
   * Max concurrent executions through this gate.
   * @default 1
   */
  readonly concurrency?: number;
}

/**
 * Configuration for {@link RunResourceApi.makeRunner}.
 *
 * @public
 */
export interface RunResourceRunnerConfig {
  /** Service name used for log annotations. */
  readonly name?: string;
  /**
   * Max concurrent executions through this runner.
   * @default 1
   */
  readonly concurrency?: number;
}

/**
 * User-gate tag returned by {@link RunResourceApi.Service} — identity plus a
 * baked-in `.layer`, `configure`, and `wrapGate`.
 *
 * @public
 */
export type RunResourceServiceDefinition<
  Self,
  T,
  A,
  E,
  Name extends string,
> = Context.Service<Self, RunGate<T, A, E>> & {
  readonly id: Name;
  readonly kind: "RunResource";
  readonly tag: Context.Service<Self, RunGate<T, A, E>>;
  readonly defaultSpec: RunResourceConfig<T, A, E> & { readonly name: Name };
  readonly configure: (
    patch: ConfigPatch<RunResourceConfig<T, A, E>>,
  ) => Layer.Layer<never>;
  readonly wrapGate: (
    fn: (
      previous: RunResourceConfig<T, A, E>["effect"],
    ) => RunResourceConfig<T, A, E>["effect"],
  ) => Layer.Layer<never>;
  readonly layer: Layer.Layer<Self>;
};

/**
 * Identity tag returned by {@link RunResourceApi.Tag} — no default layer.
 *
 * @public
 */
export type RunResourceTagDefinition<
  Self,
  T,
  A,
  E,
  Name extends string,
> = Context.Service<Self, RunGate<T, A, E>> & {
  readonly id: Name;
  readonly kind: "RunResource";
  readonly tag: Context.Service<Self, RunGate<T, A, E>>;
};

/**
 * Runner tag returned by {@link RunResourceApi.makeRunner} — identity plus
 * baked-in `.layer`.
 *
 * @public
 */
export type RunResourceRunnerDefinition<Name extends string> = Context.Service<
  RunResourceRunner & { readonly _tag: Name },
  RunResourceRunner
> & {
  readonly layer: Layer.Layer<RunResourceRunner & { readonly _tag: Name }>;
};

/**
 * The public factory surface of the {@link RunResource} domain service —
 * available both as statics on the class and as the service shape behind
 * `yield* RunResource`.
 *
 * @public
 */
export interface RunResourceApi {
  readonly make: <T, A, E>(
    config: RunResourceConfig<T, A, E>,
  ) => Effect.Effect<RunGate<T, A, E>>;

  readonly layer: <Self, T, A, E>(
    tag: Context.Key<Self, RunGate<T, A, E>>,
    config: RunResourceConfig<T, A, E>,
  ) => Layer.Layer<Self>;

  readonly Service: <Self, T, A, E = never>() => <const Name extends string>(
    name: Name,
    config: RunResourceConfig<T, A, E>,
  ) => RunResourceServiceDefinition<Self, T, A, E, Name>;

  readonly Tag: <Self, T, A, E = never>() => <const Name extends string>(
    name: Name,
  ) => RunResourceTagDefinition<Self, T, A, E, Name>;

  readonly makeRunner: <const Name extends string>(
    config: RunResourceRunnerConfig & { readonly name: Name },
  ) => RunResourceRunnerDefinition<Name>;
}

// ============================================================================
// Domain service tag
// ============================================================================

/**
 * **`RunResource`** — the concurrency-gate domain service. A real
 * `Context.Service` (id `@nikscripts/effect-pm/RunResource`) whose shape is
 * {@link RunResourceApi}. The factory statics (`make`, `layer`, `Service`,
 * `Tag`, `makeRunner`) are attached in `kernel.ts`.
 *
 * @public
 */
export class RunResource extends Context.Service<RunResource, RunResourceApi>()(
  "@nikscripts/effect-pm/RunResource",
) {}

// Keep the historical re-export name available for downstream imports during
// migration (the worker barrel re-exports these from here).
export type {
  RunResourceFact,
  RunResourceFactType,
  RunResourceRunCompletedFact,
  RunResourceRunCompletedPayload,
  RunResourceRunFailedFact,
  RunResourceRunFailedPayload,
  RunResourceRunStartedFact,
  RunResourceRunStartedPayload,
  RunResourceState,
  RunResourceStateChange,
  RunResourceStateChangeReason,
};
