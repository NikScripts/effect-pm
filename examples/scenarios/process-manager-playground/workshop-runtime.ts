/**
 * @module examples/scenarios/process-manager-playground/workshop-runtime
 *
 * Child process for `group-start workshop-group`. Re-exports `WorkshopRuntime` for
 * `Endpoint.module`; launched by ProcessManager (see README).
 */

import { Effect, Layer } from "effect";
import { WorkshopRuntime } from "./workshop-definition.js";

export { WorkshopRuntime };

void Effect.runPromise(
  Effect.never.pipe(
    Effect.provide(WorkshopRuntime.control.pipe(Layer.provide(WorkshopRuntime.layer))),
    Effect.scoped,
  ),
);
