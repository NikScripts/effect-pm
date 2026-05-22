import { Effect, Layer } from "effect";
import { ModuleEndpointRuntime } from "./process-manager-module-definition.js";

const program = Effect.never.pipe(
  Effect.provide(
    ModuleEndpointRuntime.control.pipe(Layer.provide(ModuleEndpointRuntime.layer)),
  ),
  Effect.scoped,
);

// @ts-ignore Requirement channel does not narrow to never on composed group + control layers.
void Effect.runPromise(program);
