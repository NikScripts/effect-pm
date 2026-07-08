/**
 * Built-in {@link RunResource} store contracts — shared base + extensions.
 *
 * - **Base** — `fact` + `state` shapes; `record` / `facts` / `recordStateChange` / `stateHistory`.
 * - **Internal** (`engineRunResourceStoreContract`) — narrow semantic **writes** per lifecycle trigger,
 *   each funnelling to `fact.append` or `state.append`. Engine uses `Store.effects` +
 *   `catchWriteErrors`.
 * - **Public** — tier-1 only today via {@link RunResource.store}; analytics read-extension TBD.
 *
 * @module internal/store/runResourceStoreSpec
 * @internal
 */

import { Schema } from "effect";
import type { Effect } from "effect";
import {
  makeRunCompletedFact,
  makeRunFailedFact,
  makeRunStartedFact,
  makeRunStateChange,
} from "../runResourceFacts";
import type { RunGateStatus } from "../runResource";
import { runGateStatus } from "../runResourceSchema";
import * as Store from "../../Store";
import type { ShapeHandles, StoreContractValue, StoreShapeDef } from "./contractDef";
import type { StoreWriteError } from "./errors";
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

type RunResourceShapeHandles = ShapeHandles<{
  readonly fact: ReturnType<
    typeof Store.shape<typeof runFactSchema, typeof runFactReadPayload>
  >;
  readonly state: ReturnType<
    typeof Store.shape<typeof runStateChangeSchema, typeof runStateReadPayload>
  >;
}>;

/** Shared base methods — internal/public extensions close over the same append/read handles. @internal */
const runResourceStoreBaseMethods = ({ fact, state }: RunResourceShapeHandles) => ({
  record: fact.append,
  facts: fact.read,
  recordStateChange: state.append,
  stateHistory: state.read,
});

/** Base run-resource store contract. @internal */
export type RunResourceStoreBaseContract = StoreContractValue<
  {
    readonly fact: StoreShapeDef<typeof runFactSchema, typeof runFactReadPayload>;
    readonly state: StoreShapeDef<typeof runStateChangeSchema, typeof runStateReadPayload>;
  },
  {
    readonly record: (fact: RunFact) => Effect.Effect<void, StoreWriteError>;
    readonly facts: (
      payload?: { readonly limit?: number; readonly runId?: string },
    ) => Effect.Effect<ReadonlyArray<RunFact>>;
    readonly recordStateChange: (change: RunStateChange) => Effect.Effect<void, StoreWriteError>;
    readonly stateHistory: (
      payload?: { readonly limit?: number },
    ) => Effect.Effect<ReadonlyArray<RunStateChange>>;
  }
>;

/** Built-in run-resource store contract for a tag (tier-1 / tests). @internal */
export const builtInRunResourceStoreContract = (
  _tag: StoreScopeTag,
): RunResourceStoreBaseContract =>
  Store.contract(
    {
      fact: Store.shape(runFactSchema, runFactReadPayload),
      state: Store.shape(runStateChangeSchema, runStateReadPayload),
    },
    runResourceStoreBaseMethods,
  );

/** @deprecated Use {@link RunResourceStoreBaseContract}. @internal */
export type BuiltInRunResourceContract = RunResourceStoreBaseContract;

// ============================================================================
// Internal — engine write-extension (narrow triggers → shared fact/state append)
// ============================================================================

/** @internal */
export type RunResourceRunStartedInput = {
  readonly id: string;
  readonly runId: string;
  readonly occurredAt: number;
  readonly concurrency: number;
};

/** @internal */
export type RunResourceRunCompletedInput = {
  readonly id: string;
  readonly runId: string;
  readonly occurredAt: number;
  readonly durationMs: number;
};

/** @internal */
export type RunResourceRunFailedInput = {
  readonly id: string;
  readonly runId: string;
  readonly occurredAt: number;
  readonly durationMs: number;
  readonly cause: string;
};

/**
 * Build the internal engine contract — base + narrow semantic writes per lifecycle trigger.
 * @internal
 */
export const makeEngineRunResourceStoreContract = (resourceId: string) =>
  Store.contract(
    {
      fact: Store.shape(runFactSchema, runFactReadPayload),
      state: Store.shape(runStateChangeSchema, runStateReadPayload),
    },
    (handles) => ({
      ...runResourceStoreBaseMethods(handles),
      recordRunStarted: (input: RunResourceRunStartedInput) =>
        handles.fact.append(
          makeRunStartedFact({
            id: input.id,
            resourceId,
            runId: input.runId,
            occurredAt: input.occurredAt,
            concurrency: input.concurrency,
          }),
        ),
      recordRunCompleted: (input: RunResourceRunCompletedInput) =>
        handles.fact.append(
          makeRunCompletedFact({
            id: input.id,
            resourceId,
            runId: input.runId,
            occurredAt: input.occurredAt,
            durationMs: input.durationMs,
          }),
        ),
      recordRunFailed: (input: RunResourceRunFailedInput) =>
        handles.fact.append(
          makeRunFailedFact({
            id: input.id,
            resourceId,
            runId: input.runId,
            occurredAt: input.occurredAt,
            durationMs: input.durationMs,
            cause: input.cause,
          }),
        ),
      recordGateStateChange: (input: {
        readonly id: string;
        readonly changedAt: number;
        readonly reason: RunResourceStateChangeReason;
        readonly previous: RunGateStatus | null;
        readonly current: RunGateStatus;
      }) =>
        handles.state.append(
          makeRunStateChange({
            id: input.id,
            resourceId,
            changedAt: input.changedAt,
            reason: input.reason,
            previous: input.previous,
            current: input.current,
          }),
        ),
    }),
  );

/** Internal engine contract for a resource id + scope tag. @internal */
export const engineRunResourceStoreContract = (
  resourceId: string,
  _tag?: StoreScopeTag,
) => makeEngineRunResourceStoreContract(resourceId);

/** @internal */
export type EngineRunResourceStoreContract = ReturnType<typeof engineRunResourceStoreContract>;
