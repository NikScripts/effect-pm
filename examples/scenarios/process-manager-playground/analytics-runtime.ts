/**
 * @module examples/scenarios/process-manager-playground/analytics-runtime
 *
 * Child process for `group-start analytics-group`. Re-exports `AnalyticsRuntime` for
 * `Endpoint.module`; launched by ProcessManager (see README).
 */

import { Effect, Layer } from "effect";
import { AnalyticsRuntime } from "./analytics-definition.js";

export { AnalyticsRuntime };

void Effect.runPromise(
  // @ts-ignore Requirement channel does not narrow to never on composed group + control layers.
  Effect.never.pipe(
    Effect.provide(AnalyticsRuntime.control.pipe(Layer.provide(AnalyticsRuntime.layer))),
    Effect.scoped,
  ),
);
