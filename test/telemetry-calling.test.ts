/**
 * Step 4 — calling API. The operation builder `op.provide(scopeLeaf)` installs
 * the op scope leaf and yields an {@link OperationContext}; standalone events are
 * yieldable zero-arg Effects. Emit is a no-op until the Step 6 runtime — these
 * assert the call shapes, scope wiring, and leaf typing.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { State } from "../src/State";
import { Telemetry } from "../src/Telemetry";

class DemoScope extends State.Scope("@test/CallScope", "Demo")({
  id: Schema.String,
}) {}

class DemoRunScope extends DemoScope.withLeaf("Run", {
  runId: Schema.String,
}) {}

class DemoStarted extends Telemetry.Schema<DemoStarted>()(DemoRunScope)({
  runId: DemoRunScope.Schema.State.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({ n: Schema.Number }),
}) {}

class DemoCompleted extends Telemetry.Schema<DemoCompleted>()(DemoRunScope)({
  runId: DemoRunScope.Schema.State.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
}) {}

class DemoChanged extends Telemetry.Schema<DemoChanged>()(DemoScope)({
  id: Schema.String,
  changedAt: Telemetry.terminal.clockMillis,
}) {}

const DemoTarget = { key: "@test/CallDemo" } as const;

class DemoTelemetry extends Telemetry.Tag<DemoTelemetry>(DemoTarget)(
  "@test/CallTelemetry",
  Telemetry.namespace("Demo"),
  Telemetry.group("Run")(
    Telemetry.operation("run")(
      DemoRunScope,
      Telemetry.start("Started", DemoStarted),
      Telemetry.exit({ onSuccess: Telemetry.event("Completed", DemoCompleted) }),
    ),
  ),
  Telemetry.group("State")(Telemetry.event("Changed", DemoChanged)),
) {}

describe("Telemetry calling API (Step 4)", () => {
  it("op.provide(leaf) installs the op scope into the envelope and yields OperationContext", () => {
    const ctx = Effect.runSync(
      DemoTelemetry.Run.run
        .provide({ runId: "run-1" })
        .pipe(Effect.provide(DemoScope.layer({ id: "res-1" }))),
    );
    expect(ctx.input).toBeUndefined();
    // scope view = the op's process-filtered leaf slice (currentSlice of Run)
    expect(ctx.scope).toEqual({ runId: "run-1" });
    // run has no middle events, so its telemetry handle is empty
    expect(ctx.telemetry).toEqual({});
  });

  it("the operation body runs after .provide via flatMap (emit is a no-op)", () => {
    const result = Effect.runSync(
      DemoTelemetry.Run.run
        .provide({ runId: "run-2" })
        .pipe(
          Effect.flatMap(() => Effect.succeed("body-ran")),
          Effect.provide(DemoScope.layer({ id: "res-2" })),
        ),
    );
    expect(result).toBe("body-ran");
  });

  it("a standalone event is a yieldable zero-arg no-op Effect", () => {
    const out = Effect.runSync(
      Effect.gen(function* () {
        yield* DemoTelemetry.State.Changed;
        return "after-event";
      }),
    );
    expect(out).toBe("after-event");
  });

  it("op handle keeps its wiring node handles alongside the builder", () => {
    expect(DemoTelemetry.Run.run.Started.wire).toBe("Demo.Run.Started");
    expect(DemoTelemetry.Run.run.exit.onSuccess.wire).toBe("Demo.Run.Completed");
    expect(typeof DemoTelemetry.Run.run.provide).toBe("function");
  });

  it("the scope leaf is typed (wrong / missing keys rejected)", () => {
    // Type-only assertions — declared, never invoked (the bad calls must not run).
    const _typeChecks = (): void => {
      void DemoTelemetry.Run.run.provide({ runId: "ok" });
      // @ts-expect-error - leaf key is `runId`, not `wrongId`
      void DemoTelemetry.Run.run.provide({ wrongId: "x" });
      // @ts-expect-error - missing required `runId`
      void DemoTelemetry.Run.run.provide({});
      // @ts-expect-error - events are Effect values, not callables
      void DemoTelemetry.State.Changed();
    };
    void _typeChecks;
    expect(typeof DemoTelemetry.Run.run.provide).toBe("function");
  });
});
