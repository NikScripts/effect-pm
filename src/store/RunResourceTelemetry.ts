/**
 * RunResource hub telemetry — SSoT for wire ids, schemas, and emit helpers.
 *
 * @module store/RunResourceTelemetry
 */

import { Effect, Schema } from "effect";
import { RunResource } from "../internal/runResource/service";
import { RunResourceScope, RunScope } from "../RunResourceScope";
import { Telemetry } from "../Telemetry";
import {
  defineEvent,
  emit,
  telemetryWireId,
  type TelemetryEventDefinition,
} from "../TelemetryHub";
import { RunResourceStateSchema } from "./RunResourceState";

export { RunResourceStateSchema, type RunResourceState } from "./RunResourceState";

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

type HubError = import("../TelemetryHub").TelemetryHubError;
type Hub = import("../TelemetryHub").TelemetryHub;

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

// ============================================================================
// Telemetry.Tag (Step 2 — new factory). Coexists with the `defineEvent` debt
// above until the kernel migrates (Step 8), at which point the debt is deleted.
// Schemas port the golden fields; `State.Changed` reuses the shared snapshot
// struct (D5) and the wire-reason consts above.
// ============================================================================

const RunState = RunScope.Schema.State;

/** `RunResource.Run.Started` wire payload. @public */
export class RunResourceRunStarted extends Telemetry.Schema<RunResourceRunStarted>()(
  RunScope,
)({
  runId: RunState.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({ concurrency: Schema.Number }),
}) {}

/** `RunResource.Run.Completed` wire payload. @public */
export class RunResourceRunCompleted extends Telemetry.Schema<RunResourceRunCompleted>()(
  RunScope,
)({
  runId: RunState.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({ durationMs: Schema.Number }),
}) {}

/** `RunResource.Run.Failed` wire payload. @public */
export class RunResourceRunFailed extends Telemetry.Schema<RunResourceRunFailed>()(
  RunScope,
)({
  runId: RunState.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({ durationMs: Schema.Number, cause: Schema.String }),
}) {}

/** `RunResource.State.Changed` wire payload. @public */
export class RunResourceStateChanged extends Telemetry.Schema<RunResourceStateChanged>()(
  RunResourceScope,
)({
  id: Schema.String,
  changedAt: Telemetry.terminal.clockMillis,
  reason: Schema.Literals(STATE_CHANGE_REASONS),
  previous: Schema.NullOr(RunResourceStateSchema),
  current: RunResourceStateSchema,
}) {}

/**
 * **`RunResourceTelemetry`** — the facet telemetry Tag (API 1). Targets the
 * {@link RunResource} domain service; `run` operation owns the Run start/exit
 * legs, `State.Changed` is a standalone root-scoped event.
 *
 * @public
 */
export class RunResourceTelemetry extends Telemetry.Tag<RunResourceTelemetry>(
  RunResource,
)(
  "@nikscripts/effect-pm/store/RunResource/RunResourceTelemetry",
  Telemetry.namespace("RunResource"),
  Telemetry.group("Run")(
    Telemetry.operation("run")(
      RunScope,
      Telemetry.start("Started", RunResourceRunStarted),
      Telemetry.exit({
        onSuccess: Telemetry.event("Completed", RunResourceRunCompleted),
        onFailure: Telemetry.event("Failed", RunResourceRunFailed),
      }),
    ),
  ),
  Telemetry.group("State")(
    Telemetry.event("Changed", RunResourceStateChanged),
  ),
) {}
