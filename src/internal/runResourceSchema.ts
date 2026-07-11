/**
 * RunResource wire schemas and RPC spec factory.
 *
 * @module internal/runResourceSchema
 * @internal
 */

import { Schema } from "effect";
import * as Resource from "../Resource";

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

const runObservationRefs = {
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
} as const;

const runMethodUnit = <
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
>(
  success: A,
  error: E = Schema.Never as unknown as E,
) =>
  Resource.effectFn(success, { error }).annotate({
    description:
      "Acquire a permit, run the gated effect, release the permit — returns the effect result.",
  });

const runMethodWithPayload = <
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
>(
  payload: I,
  success: A,
  error: E = Schema.Never as unknown as E,
) =>
  Resource.effectFn(success, { payload, error }).annotate({
    description:
      "Acquire a permit, run the gated effect, release the permit — returns the effect result.",
  });

/**
 * Build a run-gate **instance** spec: observation refs plus the gated `run` mutation.
 *
 * Unit gates omit `payload` — `run` surfaces as an {@link Effect.Effect} property (no wire input
 * slot). Parameterized gates pass `payload` first — `run` surfaces as `(input) => Effect`.
 *
 * @internal
 */
export function runSpec<
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
>(payload: I, success: A, error?: E): RunInstanceSpec<I, A, E>;
export function runSpec<
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
>(success: A, error?: E): RunInstanceSpec<undefined, A, E>;
export function runSpec(
  payloadOrSuccess: Schema.Top,
  successOrError?: Schema.Top,
  error?: Schema.Top,
): RunInstanceSpec<Schema.Top | undefined, Schema.Top, Schema.Top> {
  if (successOrError !== undefined && error !== undefined) {
    return {
      ...runObservationRefs,
      run: runMethodWithPayload(payloadOrSuccess, successOrError, error),
    };
  }
  if (successOrError !== undefined) {
    return {
      ...runObservationRefs,
      run: runMethodWithPayload(payloadOrSuccess, successOrError, Schema.Never),
    };
  }
  return {
    ...runObservationRefs,
    run: runMethodUnit(payloadOrSuccess),
  };
}

/** Instance spec for a run gate typed by its wire schemas. @internal */
export type RunInstanceSpec<
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
> = I extends Schema.Top
  ? {
      readonly status: ReturnType<typeof Resource.ref<typeof runGateStatus>>;
      readonly waiting: ReturnType<typeof Resource.ref<typeof Schema.Number>>;
      readonly inFlight: ReturnType<typeof Resource.ref<typeof Schema.Number>>;
      readonly completed: ReturnType<typeof Resource.ref<typeof Schema.Number>>;
      readonly failed: ReturnType<typeof Resource.ref<typeof Schema.Number>>;
      readonly interrupted: ReturnType<typeof Resource.ref<typeof Schema.Number>>;
      readonly run: ReturnType<typeof runMethodWithPayload<I, A, E>>;
    }
  : {
      readonly status: ReturnType<typeof Resource.ref<typeof runGateStatus>>;
      readonly waiting: ReturnType<typeof Resource.ref<typeof Schema.Number>>;
      readonly inFlight: ReturnType<typeof Resource.ref<typeof Schema.Number>>;
      readonly completed: ReturnType<typeof Resource.ref<typeof Schema.Number>>;
      readonly failed: ReturnType<typeof Resource.ref<typeof Schema.Number>>;
      readonly interrupted: ReturnType<typeof Resource.ref<typeof Schema.Number>>;
      readonly run: ReturnType<typeof runMethodUnit<A, E>>;
    };

/** True when the wire contract declares an input payload slot. @internal */
export const runSpecHasPayload = (payload: Schema.Top | undefined): payload is Schema.Top =>
  payload !== undefined;

/** Build a spec from resolved wire schemas — disambiguates unit vs parameterized. @internal */
export const materializeRunSpec = <
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  payload: I,
  success: A,
  error: E,
): RunInstanceSpec<I, A, E> =>
  (runSpecHasPayload(payload)
    ? {
        ...runObservationRefs,
        run: runMethodWithPayload(payload, success, error),
      }
    : {
        ...runObservationRefs,
        run: runMethodUnit(success, error),
      }) as RunInstanceSpec<I, A, E>;
