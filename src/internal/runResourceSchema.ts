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
) => ({
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
  run: Resource.effectFn(payload, success, error).annotate({
    description:
      "Acquire a permit, run the gated effect, release the permit — returns the effect result.",
  }),
});

/** Instance spec for a run gate typed by its wire schemas. @internal */
export type RunInstanceSpec<
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
> = ReturnType<typeof runSpec<I, A, E>>;
