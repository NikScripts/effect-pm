/**
 * RunResource hub telemetry — SSoT for wire ids, schemas, and emit helpers.
 *
 * @module store/runResource/telemetry
 */

import { Effect, Schema } from "effect";
import {
  defineEvent,
  emit,
  telemetryWireId,
  type TelemetryEventDefinition,
} from "../../TelemetryHub";

/** @public */
export const RUN_RESOURCE_PROCESS_TYPE = "RunResource" as const;

/** @public */
export const RUN_STARTED_WIRE = telemetryWireId("RunResource", ["Run"], "Started");
/** @public */
export const RUN_COMPLETED_WIRE = telemetryWireId("RunResource", ["Run"], "Completed");
/** @public */
export const RUN_FAILED_WIRE = telemetryWireId("RunResource", ["Run"], "Failed");
/** @public */
export const STATE_CHANGED_WIRE = telemetryWireId("RunResource", ["State"], "Changed");

/** @public */
export const STATE_WAITING_WIRE = telemetryWireId("RunResource", ["State"], "Waiting");
/** @public */
export const STATE_STARTED_WIRE = telemetryWireId("RunResource", ["State"], "Started");
/** @public */
export const STATE_COMPLETED_WIRE = telemetryWireId("RunResource", ["State"], "Completed");
/** @public */
export const STATE_FAILED_WIRE = telemetryWireId("RunResource", ["State"], "Failed");
/** @public */
export const STATE_INTERRUPTED_WIRE = telemetryWireId("RunResource", ["State"], "Interrupted");
/** @public */
export const STATE_WAIT_INTERRUPTED_WIRE = telemetryWireId(
  "RunResource",
  ["State"],
  "WaitInterrupted",
);

/** @public */
export const STATE_CHANGE_REASONS = [
  STATE_WAITING_WIRE,
  STATE_STARTED_WIRE,
  STATE_COMPLETED_WIRE,
  STATE_FAILED_WIRE,
  STATE_INTERRUPTED_WIRE,
  STATE_WAIT_INTERRUPTED_WIRE,
] as const;

/** @public */
export type RunResourceStateChangeReason =
  (typeof STATE_CHANGE_REASONS)[number];

/** @public */
export const RunResourceStateSchema = Schema.Struct({
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

/** @public */
export type RunResourceState = typeof RunResourceStateSchema.Type;

const RunFactCommonSchema = {
  resourceId: Schema.String,
  runId: Schema.String,
  occurredAt: Schema.Number,
} as const;

/** @public */
export const RunResourceRunStartedInputSchema = Schema.Struct({
  ...RunFactCommonSchema,
  payload: Schema.Struct({
    concurrency: Schema.Number,
  }),
});

/** @public */
export type RunResourceRunStartedInput =
  typeof RunResourceRunStartedInputSchema.Type;

/** @public */
export const RunResourceRunCompletedInputSchema = Schema.Struct({
  ...RunFactCommonSchema,
  payload: Schema.Struct({
    durationMs: Schema.Number,
  }),
});

/** @public */
export type RunResourceRunCompletedInput =
  typeof RunResourceRunCompletedInputSchema.Type;

/** @public */
export const RunResourceRunFailedInputSchema = Schema.Struct({
  ...RunFactCommonSchema,
  payload: Schema.Struct({
    durationMs: Schema.Number,
    cause: Schema.String,
  }),
});

/** @public */
export type RunResourceRunFailedInput =
  typeof RunResourceRunFailedInputSchema.Type;

/** @public */
export const RunResourceStateChangedInputSchema = Schema.Struct({
  id: Schema.String,
  changedAt: Schema.Number,
  reason: Schema.Literals(STATE_CHANGE_REASONS),
  previous: Schema.NullOr(RunResourceStateSchema),
  current: RunResourceStateSchema,
});

/** @public */
export type RunResourceStateChangedInput =
  typeof RunResourceStateChangedInputSchema.Type;

/** Hub SSoT for `RunResource.Run.Started`. @public */
export const RunStarted: TelemetryEventDefinition<
  RunResourceRunStartedInput,
  RunResourceRunStartedInput
> = defineEvent({
  namespace: "RunResource",
  tagPath: ["Run"],
  name: "Started",
  schema: RunResourceRunStartedInputSchema,
});

/** Hub SSoT for `RunResource.Run.Completed`. @public */
export const RunCompleted: TelemetryEventDefinition<
  RunResourceRunCompletedInput,
  RunResourceRunCompletedInput
> = defineEvent({
  namespace: "RunResource",
  tagPath: ["Run"],
  name: "Completed",
  schema: RunResourceRunCompletedInputSchema,
});

/** Hub SSoT for `RunResource.Run.Failed`. @public */
export const RunFailed: TelemetryEventDefinition<
  RunResourceRunFailedInput,
  RunResourceRunFailedInput
> = defineEvent({
  namespace: "RunResource",
  tagPath: ["Run"],
  name: "Failed",
  schema: RunResourceRunFailedInputSchema,
});

/** Hub SSoT for `RunResource.State.Changed`. @public */
export const StateChanged: TelemetryEventDefinition<
  RunResourceStateChangedInput,
  RunResourceStateChangedInput
> = defineEvent({
  namespace: "RunResource",
  tagPath: ["State"],
  name: "Changed",
  schema: RunResourceStateChangedInputSchema,
});

type HubError = import("../../TelemetryHub").TelemetryHubError;
type Hub = import("../../TelemetryHub").TelemetryHub;

/** @public */
export const runStarted = (
  input: RunResourceRunStartedInput,
): Effect.Effect<void, HubError, Hub> => emit(RunStarted, input);

/** @public */
export const runCompleted = (
  input: RunResourceRunCompletedInput,
): Effect.Effect<void, HubError, Hub> => emit(RunCompleted, input);

/** @public */
export const runFailed = (
  input: RunResourceRunFailedInput,
): Effect.Effect<void, HubError, Hub> => emit(RunFailed, input);

/** @public */
export const stateChanged = (
  input: RunResourceStateChangedInput,
): Effect.Effect<void, HubError, Hub> => emit(StateChanged, input);

/** @public */
export const RunResourceHubTelemetry = {
  Run: {
    Started: RunStarted,
    started: runStarted,
    Completed: RunCompleted,
    completed: runCompleted,
    Failed: RunFailed,
    failed: runFailed,
  },
  State: {
    Changed: StateChanged,
    changed: stateChanged,
  },
} as const;
