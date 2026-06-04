/**
 * RunResource hub telemetry — pilot slice for {@link TelemetryHub}.
 *
 * @remarks
 * Slice 6.1 stub: `State.Changed` routes through the hub without
 * {@link RuntimeStorage}. Full facet split lands in slice 6.2.
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

const STATE_CHANGE_REASONS = [
  "RunResource.State.Waiting",
  "RunResource.State.Started",
  "RunResource.State.Completed",
  "RunResource.State.Failed",
  "RunResource.State.Interrupted",
  "RunResource.State.WaitInterrupted",
] as const;

const RunResourceStateSchema = Schema.Struct({
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

/** Input schema for {@link StateChanged}. @public */
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

/** @public */
export const STATE_CHANGED_WIRE = telemetryWireId("RunResource", ["State"], "Changed");

/**
 * Emit `RunResource.State.Changed` through {@link TelemetryHub}.
 *
 * @public
 */
export const stateChanged = (
  input: RunResourceStateChangedInput,
): Effect.Effect<
  void,
  import("../../TelemetryHub").TelemetryHubError,
  import("../../TelemetryHub").TelemetryHub
> => emit(StateChanged, input);

/** @public */
export const RunResourceHubTelemetry = {
  State: {
    Changed: StateChanged,
    changed: stateChanged,
  },
} as const;
