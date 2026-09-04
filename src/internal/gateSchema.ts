/**
 * Gate wire schemas and RPC spec factory.
 *
 * @module internal/gateSchema
 * @internal
 */

import { Schema } from "effect";
import { RateLimiterError } from "effect/unstable/persistence/RateLimiter";
import * as Hyperlink from "../Hyperlink";
import type { Method, RefField } from "../Hyperlink";
import * as Lifecycle from "../Lifecycle";

/**
 * Failure when a call is admitted to a **stopped** gate (Lifecycle `Draining` /
 * `Off`), or a waiting call is failed by a `stopMode: "failWaiting"` stop.
 * In-flight bodies always finish.
 *
 * `Schema.TaggedErrorClass` so it is both yieldable **and** wire-encodable — part of
 * every Gate's `run` RPC error channel (see {@link withGateRunErrors}).
 *
 * @category errors
 * @public
 */
export class GateStopped extends Schema.TaggedErrorClass<GateStopped>()(
  "GateStopped",
  {
    resourceId: Schema.String,
  },
) {}

/**
 * Engine failures always present on Gate wire `run` — stop + rate-limit (Effect's
 * {@link RateLimiterError} is already a `Schema.ErrorClass`).
 *
 * Always-on (not gated on initial `rateLimit`): live {@link setRateLimit} can enable
 * limiting after mint, so the channel must admit the error from day one.
 *
 * @internal
 */
export const gateEngineRunError = Schema.Union([GateStopped, RateLimiterError]);

/**
 * Effective wire `run` error schema — user `error` (default {@link Schema.Never}) always
 * carries the engine union. `Never` collapses to {@link gateEngineRunError} alone.
 *
 * @internal
 */
export type WithGateRunErrors<E extends Schema.Top> = [E] extends [
  typeof Schema.Never,
]
  ? typeof gateEngineRunError
  : Schema.Union<[E, typeof GateStopped, typeof RateLimiterError]>;

/**
 * Union engine `run` errors ({@link GateStopped}, {@link RateLimiterError}) into a
 * gate's declared `run` error schema. Failures that can happen are typed — never erased.
 *
 * @internal
 */
export function withGateRunErrors(
  error: typeof Schema.Never,
): typeof gateEngineRunError;
export function withGateRunErrors<E extends Schema.Top>(
  error: E,
): WithGateRunErrors<E>;
export function withGateRunErrors<E extends Schema.Top>(
  error: E,
): WithGateRunErrors<E> {
  // SAFE: runtime schema identity vs `Schema.Never` (same as `gateSpec`);
  // generic `E` is not known to overlap `Never` at the type level. Schema.Union's
  // `readonly` tuple vs WithGateRunErrors' tuple form doesn't reduce — same schemas.
  return (
    (error as Schema.Top) === Schema.Never
      ? gateEngineRunError
      : Schema.Union([error, GateStopped, RateLimiterError])
  ) as WithGateRunErrors<E>;
}

/** Live gate counters on the wire — element of the reactive `status` ref. @internal */
export const gateStatus = Schema.Struct({
  resourceId: Schema.String,
  observedAt: Schema.Number,
  configVersion: Schema.Number,
  concurrency: Schema.Number,
  waiting: Schema.Number,
  inFlight: Schema.Number,
  completed: Schema.Number,
  failed: Schema.Number,
  interrupted: Schema.Number,
  totalDurationMs: Schema.Number,
});

type Void = typeof Schema.Void;

type GateStatusRef = RefField<
  Method<undefined, typeof gateStatus, typeof Schema.Never, true>
>;

type GateCountRef = RefField<
  Method<undefined, typeof Schema.Number, typeof Schema.Never, true>
>;

/**
 * `run` wire member — inputless {@link Hyperlink.effect} for unit gates,
 * {@link Hyperlink.effectFn} otherwise. `E` is the **effective** wire error
 * ({@link WithGateRunErrors} of the Tag's declared error).
 *
 * @internal
 */
export type GateWireMember<
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top,
> = [I] extends [Void] ? Method<undefined, A, E> : Method<I, A, E>;

const RUN_DESCRIPTION =
  "Acquire a permit, run the gated effect, release the permit — returns the effect result.";

const gateObservationRefs = () => ({
  status: Hyperlink.ref(gateStatus).annotate({
    description:
      "Live current-state snapshot: waiting, in-flight, completed, failed, interrupted, total duration.",
  }),
  waiting: Hyperlink.ref(Schema.Number).annotate({
    description: "Count of runs waiting for a concurrency permit.",
  }),
  inFlight: Hyperlink.ref(Schema.Number).annotate({
    description: "Count of runs currently executing.",
  }),
  completed: Hyperlink.ref(Schema.Number).annotate({
    description: "Count of runs that completed successfully.",
  }),
  failed: Hyperlink.ref(Schema.Number).annotate({
    description: "Count of runs that failed (excluding interrupts).",
  }),
  interrupted: Hyperlink.ref(Schema.Number).annotate({
    description: "Count of runs interrupted while waiting or executing.",
  }),
});

/**
 * Limiter live fields under the wire nest (default key {@link DEFAULT_METRICS_KEY}).
 * Updated when `rateLimit` is set; otherwise idle zeros.
 *
 * @internal
 */
export const gateMetricsNestSpec = {
  remaining: Hyperlink.ref(Schema.Number).annotate({
    description:
      "Tokens remaining in the current rate-limit window after the last consume.",
  }),
  resetAfter: Hyperlink.ref(Schema.Number).annotate({
    description:
      "Milliseconds until the rate-limit window fully resets (last consume).",
  }),
  exceeded: Hyperlink.ref(Schema.Number).annotate({
    description:
      "Count of rate-limit exceed events (delay or reject) since the gate built.",
  }),
} as const;

/** Default nest path for limiter observation (rename via Tag/Service `metricsKey` later). @internal */
export const DEFAULT_METRICS_KEY = "metrics" as const;

// ── Live reconfig verbs (wire) ───────────────────────────────────────────────

/**
 * Reconfigurable rate-limit options over the wire — `window` as a {@link Schema.Duration};
 * `key` inherits the gate id. Minimal reconfig surface (not the full consume-options bag).
 *
 * @internal
 */
export const gateRateLimitReconfig = Schema.Struct({
  limit: Schema.Number,
  window: Schema.Duration,
  tokens: Schema.optional(Schema.Number),
  onExceeded: Schema.optional(Schema.Literals(["delay", "fail"])),
});

/** `setRateLimit` payload — reconfig options, or `null` to clear the limit. @internal */
export const gateSetRateLimitPayload = Schema.NullOr(gateRateLimitReconfig);

/** Decoded `setRateLimit` input (reconfig struct or `null`). @internal */
export type GateSetRateLimitInput = Schema.Schema.Type<
  typeof gateSetRateLimitPayload
>;

const setConcurrencyMethod = Hyperlink.effectFn(
  Schema.Number,
  Schema.Void,
).annotate({
  description: "Live-resize the concurrency limit (Semaphore.resize).",
});

const setRateLimitMethod = Hyperlink.effectFn(
  gateSetRateLimitPayload,
  Schema.Void,
).annotate({
  description:
    "Live-reconfigure the rate limit (bumps configVersion); null clears it.",
});

/**
 * Live reconfig verbs mixed into the gate spec. A **type alias** (not an interface) so the
 * {@link GateInstanceSpec} intersection keeps its implicit string index signature and still
 * satisfies the {@link Hyperlink.Spec} constraint. @internal
 */
export type GateReconfigSpec = {
  readonly setConcurrency: typeof setConcurrencyMethod;
  readonly setRateLimit: typeof setRateLimitMethod;
};

/** Pausable Lifecycle participation shared by every gate spec. @internal */
const gateLifecycleSpec: Lifecycle.SpecPausable = Lifecycle.spec({
  pausable: true,
});

/**
 * Instance spec typed by the Tag's **declared** schemas. Written as a **single object
 * literal** (Lifecycle + reconfig members spliced via indexed access, not an `&`
 * intersection) so it keeps the implicit string index signature that satisfies
 * {@link Hyperlink.Spec}. `E` is the user error schema (default {@link Schema.Never});
 * `run`'s wire error is always {@link WithGateRunErrors}`<E>` so engine failures
 * (`GateStopped`, `RateLimiterError`) stay catchable on Tag/Service.
 *
 * @internal
 */
export type GateInstanceSpec<
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
> = {
  readonly status: GateStatusRef;
  readonly waiting: GateCountRef;
  readonly inFlight: GateCountRef;
  readonly completed: GateCountRef;
  readonly failed: GateCountRef;
  readonly interrupted: GateCountRef;
  readonly metrics: typeof gateMetricsNestSpec;
  readonly run: GateWireMember<I, A, WithGateRunErrors<E>>;
  readonly lifecycle: Lifecycle.SpecPausable["lifecycle"];
  readonly lifecycleEvents: Lifecycle.SpecPausable["lifecycleEvents"];
  readonly start: Lifecycle.SpecPausable["start"];
  readonly pause: Lifecycle.SpecPausable["pause"];
  readonly resume: Lifecycle.SpecPausable["resume"];
  readonly stop: Lifecycle.SpecPausable["stop"];
  readonly setConcurrency: GateReconfigSpec["setConcurrency"];
  readonly setRateLimit: GateReconfigSpec["setRateLimit"];
};

const withMetricsNest = <T extends object>(spec: T) => ({
  ...spec,
  metrics: gateMetricsNestSpec,
});

/** Mix Lifecycle participation (`pausable`) + live reconfig verbs into a gate spec. @internal */
const withControls = <T extends object>(spec: T) => ({
  ...spec,
  ...gateLifecycleSpec,
  setConcurrency: setConcurrencyMethod,
  setRateLimit: setRateLimitMethod,
});

const gateSpecVoid = <A extends Schema.Top>(
  success: A,
): GateInstanceSpec<Void, A, typeof Schema.Never> =>
  withControls(
    withMetricsNest({
      ...gateObservationRefs(),
      // SAFE: `effect(success, gateEngineRunError).annotate` is Method<undefined, A, EngineE>;
      // GateWireMember is that Method alias — annotate's extra type params don't reduce
      // under generic `A`. Nothing to validate at runtime.
      run: Hyperlink.effect(success, gateEngineRunError).annotate({
        description: RUN_DESCRIPTION,
      }) as GateWireMember<Void, A, typeof gateEngineRunError>,
    }),
  );

const gateSpecVoidWithError = <A extends Schema.Top, E extends Schema.Top>(
  success: A,
  error: E,
): GateInstanceSpec<Void, A, E> => {
  const wireError = withGateRunErrors(error);
  return withControls(
    withMetricsNest({
      ...gateObservationRefs(),
      // SAFE: same Method⇄GateWireMember annotate opacity as gateSpecVoid.
      run: Hyperlink.effect(success, wireError).annotate({
        description: RUN_DESCRIPTION,
      }) as GateWireMember<Void, A, WithGateRunErrors<E>>,
    }),
  );
};

const gateSpecWithPayload = <
  I extends Exclude<Schema.Top, Void>,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  payload: I,
  success: A,
  error: E,
): GateInstanceSpec<I, A, E> => {
  const wireError = withGateRunErrors(error);
  return withControls(
    withMetricsNest({
      ...gateObservationRefs(),
      // SAFE: `effectFn({ payload, success, error }).annotate` is Method<I, A, WireE>;
      // GateWireMember is that alias — deferred Schema.Top params + annotate erase the
      // overlap. Nothing to validate at runtime.
      run: Hyperlink.effectFn({
        payload,
        success,
        error: wireError,
      }).annotate({
        description: RUN_DESCRIPTION,
      }) as unknown as GateWireMember<I, A, WithGateRunErrors<E>>,
    }),
  );
};

/**
 * Build a gate **instance** spec: observation refs plus the gated `run` mutation.
 *
 * @internal
 */
export function gateSpec<A extends Schema.Top>(
  payload: Void,
  success: A,
): GateInstanceSpec<Void, A, typeof Schema.Never>;
export function gateSpec<A extends Schema.Top, E extends Schema.Top>(
  payload: Void,
  success: A,
  error: E,
): GateInstanceSpec<Void, A, E>;
export function gateSpec<I extends Exclude<Schema.Top, Void>, A extends Schema.Top>(
  payload: I,
  success: A,
): GateInstanceSpec<I, A, typeof Schema.Never>;
export function gateSpec<
  I extends Exclude<Schema.Top, Void>,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  payload: I,
  success: A,
  error: E,
): GateInstanceSpec<I, A, E>;
export function gateSpec(
  payload: Schema.Top,
  success: Schema.Top,
  error: Schema.Top = Schema.Never,
): GateInstanceSpec<Schema.Top, Schema.Top, Schema.Top> {
  if (payload === Schema.Void) {
    return (error as Schema.Top) === Schema.Never
      ? gateSpecVoid(success)
      : gateSpecVoidWithError(success, error);
  }
  return gateSpecWithPayload(payload, success, error);
}
