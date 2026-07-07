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
import { errorOf, successOf } from "../runTagSchemas";
import { runGateStatus } from "../runResourceSchema";
import type { StoreContractValue, StoreShapeDef } from "./contractDef";
import type { StoreScopeTag } from "./registration";

/** Reasons attached to run gate state transitions. @internal */
export type RunResourceStateChangeReason =
  | "run-resource.run.waiting"
  | "run-resource.run.started"
  | "run-resource.run.completed"
  | "run-resource.run.failed"
  | "run-resource.run.interrupted"
  | "run-resource.run.wait.interrupted";

/** Live gate counters persisted on state transitions. @internal */
export const runStateSchema = runGateStatus;

const runStartedFields = {
  id: Schema.String,
  resourceId: Schema.String,
  runId: Schema.String,
  type: Schema.Literal("run-resource.run.started"),
  occurredAt: Schema.Number,
  concurrency: Schema.Number,
} as const;

const runFinishedFactBase = {
  id: Schema.String,
  resourceId: Schema.String,
  runId: Schema.String,
  occurredAt: Schema.Number,
  durationMs: Schema.Number,
} as const;

/** @internal */
export const runStartedFactSchema = Schema.Struct(runStartedFields);

/**
 * Build the run fact union for a store contract.
 * When `success` is set, `completed` carries an optional `success` value.
 * Failures persist a structured {@link Schema.Cause} (not a pretty string).
 *
 * @internal
 */
export const makeRunFactSchema = <
  Success extends Schema.Top | void = void,
  Error extends Schema.Top | void = void,
>(
  success?: Success extends Schema.Top ? Success : never,
  error?: Error extends Schema.Top ? Error : never,
) => {
  const completedFields =
    success === undefined
      ? { ...runFinishedFactBase, type: Schema.Literal("run-resource.run.completed") }
      : {
          ...runFinishedFactBase,
          type: Schema.Literal("run-resource.run.completed"),
          success: Schema.optional(success),
        };

  const cause = Schema.Cause(
    error === undefined ? Schema.Unknown : error,
    Schema.Unknown,
  );

  return Schema.Union([
    runStartedFactSchema,
    Schema.Struct(completedFields),
    Schema.Struct({
      ...runFinishedFactBase,
      type: Schema.Literal("run-resource.run.failed"),
      cause,
    }),
  ]);
};

/** Default void run facts (no `success`; structured `Cause`). @internal */
export const runFactSchema = makeRunFactSchema();

/** @internal */
export const runCompletedFactSchema = Schema.Struct({
  ...runFinishedFactBase,
  type: Schema.Literal("run-resource.run.completed"),
});

/** @internal */
export const runFailedFactSchema = Schema.Struct({
  ...runFinishedFactBase,
  type: Schema.Literal("run-resource.run.failed"),
  cause: Schema.Cause(Schema.Unknown, Schema.Unknown),
});

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

/** Persisted run fact for the default void contract. @internal */
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

/** Build the run store contract (optional success / error schemas). @internal */
export const makeRunResourceStoreContract = (
  success?: Schema.Top,
  error?: Schema.Top,
): BuiltInRunResourceContract =>
  Store.contract(
    {
      fact: Store.shape(makeRunFactSchema(success, error), runFactReadPayload),
      state: Store.shape(runStateChangeSchema, runStateReadPayload),
    },
    ({ fact, state }) => ({
      record: fact.append,
      facts: fact.read,
      recordStateChange: state.append,
      stateHistory: state.read,
    }),
  ) as BuiltInRunResourceContract;

/** Built-in run-resource store contract for a tag (reads `success` / `error` from tag). @internal */
export const builtInRunResourceStoreContract = (
  tag: StoreScopeTag,
): BuiltInRunResourceContract =>
  makeRunResourceStoreContract(successOf(tag), errorOf(tag));

/** @deprecated Internal flat spec — use {@link builtInRunResourceStoreContract}. @internal */
export const builtInRunResourceStoreSpec = (tag: StoreScopeTag) =>
  builtInRunResourceStoreContract(tag).spec;
