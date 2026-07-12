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
  Method<"query", undefined, typeof runGateStatus, typeof Schema.Never, true>
>;

type RunCountRef = RefField<
  Method<"query", undefined, typeof Schema.Number, typeof Schema.Never, true>
>;

/** `run` wire member — inputless {@link Resource.effect} for unit gates, {@link Resource.effectFn} otherwise. @internal */
type RunWireMember<
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top,
> = [I] extends [Void]
  ? [E] extends [typeof Schema.Never]
    ? Method<"query", undefined, A, typeof Schema.Never>
    : Method<"query", undefined, A, E>
  : Method<"mutate", I, A, E>;

const isVoidPayload = (payload: Schema.Top): payload is Void => payload === Schema.Void;

const runWire = <
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  payload: I,
  success: A,
  error: E,
): RunWireMember<I, A, E> => {
  if (isVoidPayload(payload)) {
    if ((error as Schema.Top) === Schema.Never) {
      return Resource.effect(success) as RunWireMember<I, A, E>;
    }
    return Resource.effect(success, error) as RunWireMember<I, A, E>;
  }
  return Resource.effectFn({ payload, success, error }) as unknown as RunWireMember<I, A, E>;
};

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

/**
 * Build a run-gate **instance** spec: observation refs plus the gated `run` mutation.
 *
 * @internal
 */
export const runSpec = <
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
>(
  payload: I,
  success: A,
  error: E = Schema.Never as unknown as E,
): RunInstanceSpec<I, A, E> => ({
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
  run: runWire(payload, success, error).annotate({
    description:
      "Acquire a permit, run the gated effect, release the permit — returns the effect result.",
  }) as RunWireMember<I, A, E>,
});
