/**
 * Gate wire schemas and RPC spec factory.
 *
 * @module internal/gateSchema
 * @internal
 */

import { Schema } from "effect";
import * as Hyperlink from "../Hyperlink";
import type { Method, RefField } from "../Hyperlink";

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

/** `run` wire member — inputless {@link Hyperlink.effect} for unit gates, {@link Hyperlink.effectFn} otherwise. @internal */
export type GateWireMember<
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top,
> = [I] extends [Void]
  ? [E] extends [typeof Schema.Never]
    ? Method<undefined, A, typeof Schema.Never>
    : Method<undefined, A, E>
  : Method<I, A, E>;

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

/** Instance spec for a gate typed by its wire schemas. @internal */
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
  readonly run: GateWireMember<I, A, E>;
};

const withMetricsNest = <T extends object>(spec: T) => ({
  ...spec,
  metrics: gateMetricsNestSpec,
});

const gateSpecVoid = <A extends Schema.Top>(
  success: A,
): GateInstanceSpec<Void, A, typeof Schema.Never> =>
  withMetricsNest({
    ...gateObservationRefs(),
    run: Hyperlink.effect(success).annotate({ description: RUN_DESCRIPTION }) as GateWireMember<
      Void,
      A,
      typeof Schema.Never
    >,
  });

const gateSpecVoidWithError = <A extends Schema.Top, E extends Schema.Top>(
  success: A,
  error: E,
): GateInstanceSpec<Void, A, E> =>
  withMetricsNest({
    ...gateObservationRefs(),
    run: Hyperlink.effect(success, error).annotate({ description: RUN_DESCRIPTION }) as GateWireMember<
      Void,
      A,
      E
    >,
  });

const gateSpecWithPayload = <
  I extends Exclude<Schema.Top, Void>,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  payload: I,
  success: A,
  error: E,
): GateInstanceSpec<I, A, E> =>
  withMetricsNest({
    ...gateObservationRefs(),
    run: Hyperlink.effectFn({ payload, success, error }).annotate({
      description: RUN_DESCRIPTION,
    }) as unknown as GateWireMember<I, A, E>,
  });

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
