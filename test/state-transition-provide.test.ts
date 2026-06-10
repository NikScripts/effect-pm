/**
 * Step 5.2b — envelope ↔ op `.provide` unification. `State.installLeaf` /
 * `clearLeaf` / `currentSlice` write/read the single-writer envelope, and the
 * telemetry operation builder installs its scope leaf into `envelope.current`
 * (not a separate Context layer), so `State.Changed` can materialize from one
 * `current` tree.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { State } from "../src/State";
import { Telemetry } from "../src/Telemetry";

class GateScope extends State.Scope("@test/TpGate", "Gate")({
  resourceId: Schema.String,
  concurrency: Schema.Number,
}) {}

class GateRunScope extends GateScope.withLeaf("Run", {
  runId: Schema.String,
}) {}

const seed = GateScope.layer({ resourceId: "r1", concurrency: 4 });

describe("State install/clear/current leaf", () => {
  it("installLeaf inserts the nest into current (COW previous)", () => {
    const env = Effect.runSync(
      Effect.gen(function* () {
        yield* State.installLeaf(GateRunScope, { runId: "run-1" });
        return yield* State.Root;
      }).pipe(Effect.provide(seed)),
    );
    expect(env.current).toEqual({
      resourceId: "r1",
      concurrency: 4,
      Run: { runId: "run-1" },
    });
    expect(env.previous).toEqual({ resourceId: "r1", concurrency: 4 });
  });

  it("currentSlice reads the live filtered leaf slice", () => {
    const slice = Effect.runSync(
      Effect.gen(function* () {
        yield* State.installLeaf(GateRunScope, { runId: "run-2" });
        return yield* State.currentSlice(GateRunScope);
      }).pipe(Effect.provide(seed)),
    );
    expect(slice).toEqual({ runId: "run-2" });
  });

  it("clearLeaf removes the nest on exit (COW)", () => {
    const env = Effect.runSync(
      Effect.gen(function* () {
        yield* State.installLeaf(GateRunScope, { runId: "run-3" });
        yield* State.clearLeaf(GateRunScope);
        return yield* State.Root;
      }).pipe(Effect.provide(seed)),
    );
    expect("Run" in env.current).toBe(false);
    expect(env.current).toEqual({ resourceId: "r1", concurrency: 4 });
  });

  it("re-provide overwrites the leaf nest", () => {
    const slice = Effect.runSync(
      Effect.gen(function* () {
        yield* State.installLeaf(GateRunScope, { runId: "run-a" });
        yield* State.installLeaf(GateRunScope, { runId: "run-b" });
        return yield* State.currentSlice(GateRunScope);
      }).pipe(Effect.provide(seed)),
    );
    expect(slice).toEqual({ runId: "run-b" });
  });
});

// Telemetry op builder writes the SAME envelope (no scope.layer Context mutation).
class Started extends Telemetry.Schema<Started>()(GateRunScope)({
  runId: GateRunScope.Schema.State.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
}) {}

class Done extends Telemetry.Schema<Done>()(GateRunScope)({
  occurredAt: Telemetry.terminal.clockMillis,
}) {}

const Target = { key: "@test/TpDemo" } as const;

class TpTelemetry extends Telemetry.Tag<TpTelemetry>(Target)(
  "@test/TpTelemetry",
  Telemetry.namespace("Gate"),
  Telemetry.group("Run")(
    Telemetry.operation("run")(
      GateRunScope,
      Telemetry.start("Started", Started),
      Telemetry.exit({ onSuccess: Telemetry.event("Done", Done) }),
    ),
  ),
) {}

describe("op.provide ↔ envelope", () => {
  it("op.provide updates State.Root.current (single source of truth)", () => {
    const result = Effect.runSync(
      Effect.gen(function* () {
        const ctx = yield* TpTelemetry.Run.run.provide({ runId: "run-9" });
        const env = yield* State.Root;
        return { scope: ctx.scope, current: env.current };
      }).pipe(Effect.provide(seed)),
    );
    expect(result.current).toEqual({
      resourceId: "r1",
      concurrency: 4,
      Run: { runId: "run-9" },
    });
    expect(result.scope).toEqual({ runId: "run-9" });
  });

  it("OperationContext.scope === State.currentSlice(opScope)", () => {
    const result = Effect.runSync(
      Effect.gen(function* () {
        const ctx = yield* TpTelemetry.Run.run.provide({ runId: "run-10" });
        const slice = yield* State.currentSlice(GateRunScope);
        return { ctxScope: ctx.scope, slice };
      }).pipe(Effect.provide(seed)),
    );
    expect(result.ctxScope).toEqual(result.slice);
  });
});
