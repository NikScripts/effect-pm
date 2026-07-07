/**
 * Built-in {@link RunResource} store contract.
 *
 * Persists run lifecycle facts (`started` / `completed` / `failed`) and gate state transitions
 * for operator history — the durable counterpart to live {@link Subscribable} views on the handle.
 *
 * @module internal/store/runResourceStoreSpec
 * @internal
 */

import { Schema } from "effect";
import type { Effect } from "effect";
import * as Store from "../../Store";
import { runGateStatus } from "../runResourceSchema";
import type { StoreContractValue, StoreShapeDef } from "./contractDef";
import type { StoreScopeTag } from "./registration";

/** Live gate counters persisted on state transitions. @internal */
export const runStateSchema = runGateStatus;

/** @internal */
export const runStartedFactSchema = Schema.Struct({
  id: Schema.String,
  resourceId: Schema.String,
  runId: Schema.String,
  type: Schema.Literal("run-resource.run.started"),
  occurredAt: Schema.Number,
  concurrency: Schema.Number,
});

/** @internal */
export const runCompletedFactSchema = Schema.Struct({
  id: Schema.String,
  resourceId: Schema.String,
  runId: Schema.String,
  type: Schema.Literal("run-resource.run.completed"),
  occurredAt: Schema.Number,
  durationMs: Schema.Number,
});

/** @internal */
export const runFailedFactSchema = Schema.Struct({
  id: Schema.String,
  resourceId: Schema.String,
  runId: Schema.String,
  type: Schema.Literal("run-resource.run.failed"),
  occurredAt: Schema.Number,
  durationMs: Schema.Number,
  cause: Schema.String,
});

/** Discriminated union of run lifecycle facts. @internal */
export const runFactSchema = Schema.Union([
  runStartedFactSchema,
  runCompletedFactSchema,
  runFailedFactSchema,
]);

/** State transition row — mirrors legacy `RunResourceStateChange`. @internal */
export const runStateChangeSchema = Schema.Struct({
  id: Schema.String,
  resourceId: Schema.String,
  changedAt: Schema.Number,
  reason: Schema.String,
  previous: Schema.NullOr(runStateSchema),
  current: runStateSchema,
});

/** Read payload for built-in `facts`. @internal */
export const runFactReadPayload = Schema.Struct({
  limit: Schema.optional(Schema.Number),
  runId: Schema.optional(Schema.String),
});

/** Read payload for built-in `stateHistory`. @internal */
export const runStateReadPayload = Schema.Struct({
  limit: Schema.optional(Schema.Number),
});

/** Persisted run fact for a tag scope. @internal */
export type RunFact = Schema.Schema.Type<typeof runFactSchema>;

/** Persisted state transition for a tag scope. @internal */
export type RunStateChange = Schema.Schema.Type<typeof runStateChangeSchema>;

/** Built-in run-resource store contract. @internal */
export type BuiltInRunResourceContract = StoreContractValue<
  {
    readonly fact: StoreShapeDef<typeof runFactSchema, typeof runFactReadPayload>;
    readonly state: StoreShapeDef<typeof runStateChangeSchema, typeof runStateReadPayload>;
  },
  {
    readonly record: (fact: RunFact) => Effect.Effect<void>;
    readonly facts: (
      payload?: { readonly limit?: number; readonly runId?: string },
    ) => Effect.Effect<ReadonlyArray<RunFact>>;
    readonly recordStateChange: (change: RunStateChange) => Effect.Effect<void>;
    readonly stateHistory: (
      payload?: { readonly limit?: number },
    ) => Effect.Effect<ReadonlyArray<RunStateChange>>;
  }
>;

/** Built-in run-resource store contract for a tag. @internal */
export const builtInRunResourceStoreContract = (
  _tag: StoreScopeTag,
): BuiltInRunResourceContract =>
  Store.contract(
    {
      fact: Store.shape(runFactSchema, runFactReadPayload),
      state: Store.shape(runStateChangeSchema, runStateReadPayload),
    },
    ({ fact, state }) => ({
      record: fact.append,
      facts: fact.read,
      recordStateChange: state.append,
      stateHistory: state.read,
    }),
  ) as BuiltInRunResourceContract;