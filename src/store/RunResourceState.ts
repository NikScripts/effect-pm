/**
 * RunResource gate **state snapshot** schema — shared by telemetry events,
 * archive rows, projection, and the kernel counter model.
 *
 * This is the **process-visible snapshot** embedded in `State.Changed` payloads
 * (`previous` / `current`). It is **not** the telemetry-only hidden fields added
 * by `Telemetry.extend` on the scope (those live on the wiring path only).
 *
 * @remarks
 * **D5 lock (Jun 2026):** lives here so {@link ./RunResourceTelemetry} debt
 * (`defineEvent`, hub helpers) can be deleted without orphaning store/projection
 * types. The new `RunResourceTelemetry` Tag class imports this schema for
 * `State.Changed` — it does not redefine the struct.
 *
 * @module store/RunResourceState
 */

import { Schema } from "effect";

/**
 * Live counter snapshot for a {@link RunResource} gate at a point in time.
 *
 * @public
 */
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
