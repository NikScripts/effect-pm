/**
 * RunResource wire schemas and RPC spec factory.
 *
 * @module internal/runResourceSchema
 * @internal
 */

import { Schema } from "effect";
import * as Resource from "../Resource";
import type { Method, RefField } from "../Resource";

/** Live gate counters on the wire — element of the reactive `status` ref. @internal */
export const runGateStatus = Schema.Struct({
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

type RunStatusRef = RefField<
  Method<undefined, typeof runGateStatus, typeof Schema.Never, true>
>;

type RunCountRef = RefField<
  Method<undefined, typeof Schema.Number, typeof Schema.Never, true>
>;

/** `run` wire member — inputless {@link Resource.effect} for unit gates, {@link Resource.effectFn} otherwise. @internal */
export type RunWireMember<
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

const runObservationRefs = () => ({
  status: Resource.ref(runGateStatus).annotate({
    description:
      "Live current-state snapshot: waiting, in-flight, completed, failed, interrupted, total duration.",
  }),
  waiting: Resource.ref(Schema.Number).annotate({
    description: "Count of runs waiting for a concurrency permit.",
  }),
  inFlight: Resource.ref(Schema.Number).annotate({
    description: "Count of runs currently executing.",
  }),
  completed: Resource.ref(Schema.Number).annotate({
    description: "Count of runs that completed successfully.",
  }),
  failed: Resource.ref(Schema.Number).annotate({
    description: "Count of runs that failed (excluding interrupts).",
  }),
  interrupted: Resource.ref(Schema.Number).annotate({
    description: "Count of runs interrupted while waiting or executing.",
  }),
});

/** Instance spec for a run gate typed by its wire schemas. @internal */
export type RunInstanceSpec<
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
> = {
  readonly status: RunStatusRef;
  readonly waiting: RunCountRef;
  readonly inFlight: RunCountRef;
  readonly completed: RunCountRef;
  readonly failed: RunCountRef;
  readonly interrupted: RunCountRef;
  readonly run: RunWireMember<I, A, E>;
};

const runSpecVoid = <A extends Schema.Top>(
  success: A,
): RunInstanceSpec<Void, A, typeof Schema.Never> => ({
  ...runObservationRefs(),
  run: Resource.effect(success).annotate({ description: RUN_DESCRIPTION }) as RunWireMember<
    Void,
    A,
    typeof Schema.Never
  >,
});

const runSpecVoidWithError = <A extends Schema.Top, E extends Schema.Top>(
  success: A,
  error: E,
): RunInstanceSpec<Void, A, E> => ({
  ...runObservationRefs(),
  run: Resource.effect(success, error).annotate({ description: RUN_DESCRIPTION }) as RunWireMember<
    Void,
    A,
    E
  >,
});

const runSpecWithPayload = <
  I extends Exclude<Schema.Top, Void>,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  payload: I,
  success: A,
  error: E,
): RunInstanceSpec<I, A, E> => ({
  ...runObservationRefs(),
  run: Resource.effectFn({ payload, success, error }).annotate({
    description: RUN_DESCRIPTION,
  }) as unknown as RunWireMember<I, A, E>,
});

/**
 * Build a run-gate **instance** spec: observation refs plus the gated `run` mutation.
 *
 * @internal
 */
export function runSpec<A extends Schema.Top>(
  payload: Void,
  success: A,
): RunInstanceSpec<Void, A, typeof Schema.Never>;
export function runSpec<A extends Schema.Top, E extends Schema.Top>(
  payload: Void,
  success: A,
  error: E,
): RunInstanceSpec<Void, A, E>;
export function runSpec<I extends Exclude<Schema.Top, Void>, A extends Schema.Top>(
  payload: I,
  success: A,
): RunInstanceSpec<I, A, typeof Schema.Never>;
export function runSpec<
  I extends Exclude<Schema.Top, Void>,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  payload: I,
  success: A,
  error: E,
): RunInstanceSpec<I, A, E>;
export function runSpec(
  payload: Schema.Top,
  success: Schema.Top,
  error: Schema.Top = Schema.Never,
): RunInstanceSpec<Schema.Top, Schema.Top, Schema.Top> {
  if (payload === Schema.Void) {
    return (error as Schema.Top) === Schema.Never
      ? runSpecVoid(success)
      : runSpecVoidWithError(success, error);
  }
  return runSpecWithPayload(payload, success, error);
}
