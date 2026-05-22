import { Effect, Layer } from "effect";
import { ModuleEndpointRuntime } from "./process-manager-module-definition.js";

const program = Effect.never.pipe(
  Effect.provide(
    ModuleEndpointRuntime.control.pipe(Layer.provide(ModuleEndpointRuntime.layer)),
  ),
  Effect.scoped,
);

void Effect.runPromise(program);
