/**
 * Built-in {@link RunResource} store contract.
 *
 * Persists run lifecycle facts (`RunStarted` / `RunCompleted` / `RunFailed`) and gate state
 * transitions for operator history — the durable counterpart to live {@link Subscribable} views.
 *
 * @module internal/store/runResourceStoreSpec
 * @internal
 */

import { Schema } from "effect";
import type { Effect } from "effect";
import * as Store from "../../Store";
import { makeRunResourceFactEvent, runFactReadPayload } from "../runResourceEvent";
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

/** Default void run facts. @internal */
export const runFactSchema = makeRunResourceFactEvent();

/** State transition row — mirrors legacy `RunResourceStateChange`. @internal */
export const runStateChangeSchema = Schema.Struct({
  id: Schema.String,
  resourceId: Schema.String,
  changedAt: Schema.Number,
  reason: Schema.String,
  previous: Schema.NullOr(runStateSchema),
  current: runStateSchema,
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
      fact: Store.shape(makeRunResourceFactEvent(success, error), runFactReadPayload),
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

export { runFactReadPayload };
