import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { State } from "../src/State";
import {
  type EventNode,
  EventNodeTypeId,
  Telemetry,
} from "../src/Telemetry";

// A minimal domain: scope + leaf, event schemas, and a Tag exercising every
// tree shape (group→operation→start/exit, group→event).

class DemoScope extends State.Scope("@test/DemoScope", "Demo")({
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

class DemoFailed extends Telemetry.Schema<DemoFailed>()(DemoRunScope)({
  runId: DemoRunScope.Schema.State.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
}) {}

class DemoChanged extends Telemetry.Schema<DemoChanged>()(DemoScope)({
  id: Schema.String,
  changedAt: Telemetry.terminal.clockMillis,
}) {}

// Stand-in for the target domain service (only its `.key` identity is used).
const DemoTarget = { key: "@test/Demo" } as const;

class DemoTelemetry extends Telemetry.Tag<DemoTelemetry>()(DemoTarget)(
  "@test/DemoTelemetry",
  Telemetry.namespace("Demo"),
  Telemetry.group("Run")(
    Telemetry.operation("run")(
      DemoRunScope,
      Telemetry.start("Started", DemoStarted),
      Telemetry.exit({
        onSuccess: Telemetry.event("Completed", DemoCompleted),
        onFailure: Telemetry.event("Failed", DemoFailed),
      }),
    ),
  ),
  Telemetry.group("State")(Telemetry.event("Changed", DemoChanged)),
) {}

describe("Telemetry.Tag", () => {
  it("derives wire ids as Namespace.Group.Event (operation name excluded)", () => {
    expect(DemoTelemetry.Run.run.Started.wire).toBe("Demo.Run.Started");
    expect(DemoTelemetry.Run.run.exit.onSuccess.wire).toBe("Demo.Run.Completed");
    expect(DemoTelemetry.Run.run.exit.onFailure.wire).toBe("Demo.Run.Failed");
    expect(DemoTelemetry.State.Changed.wire).toBe("Demo.State.Changed");
  });

  it("exposes namespace + target metadata", () => {
    expect(DemoTelemetry.namespace).toBe("Demo");
    expect(DemoTelemetry.target).toBe(DemoTarget);
    expect(DemoTelemetry.facetId).toBe("@test/DemoTelemetry");
  });

  it("node handles are branded and carry their tree path", () => {
    expect(DemoTelemetry.Run.run.Started[EventNodeTypeId]).toBe(EventNodeTypeId);
    expect(DemoTelemetry.Run.run.Started.path).toEqual(["Run", "run", "Started"]);
    expect(DemoTelemetry.Run.run.exit.onFailure.path).toEqual([
      "Run",
      "run",
      "exit",
      "onFailure",
    ]);
    expect(DemoTelemetry.State.Changed.path).toEqual(["State", "Changed"]);
  });

  it("handles carry their event schema type (compile-time)", () => {
    // These annotations fail to compile if the handle mapped types are wrong.
    const started: EventNode<typeof DemoStarted> = DemoTelemetry.Run.run.Started;
    const completed: EventNode<typeof DemoCompleted> =
      DemoTelemetry.Run.run.exit.onSuccess;
    const changed: EventNode<typeof DemoChanged> = DemoTelemetry.State.Changed;
    expect(started.schema).toBe(DemoStarted);
    expect(completed.schema).toBe(DemoCompleted);
    expect(changed.schema).toBe(DemoChanged);
  });
});
