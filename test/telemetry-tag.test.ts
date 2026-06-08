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

class DemoTelemetry extends Telemetry.Tag<DemoTelemetry>(DemoTarget)(
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

class DemoSnapshot extends Telemetry.Schema<DemoSnapshot>()(DemoScope)({
  id: DemoScope.Schema.State.id,
  observedAt: Telemetry.terminal.clockMillis,
}) {}

class DemoWithSnapshot extends Telemetry.Schema<DemoWithSnapshot>()(DemoScope)({
  id: Schema.String,
  changedAt: Telemetry.terminal.clockMillis,
  current: DemoSnapshot,
}) {}

describe("Telemetry.Schema.Struct", () => {
  it("exposes Struct on the schema class", () => {
    expect(DemoStarted.Struct).toBeDefined();
    expect(Schema.isSchema(DemoStarted.Struct)).toBe(true);
  });

  it("Struct normalizes scope selectors and terminals to regular schema fields", () => {
    const decoded = Schema.decodeUnknownSync(DemoStarted.Struct as never)({
      runId: "run-1",
      occurredAt: 1_700_000_000_000,
      payload: { n: 2 },
    });
    expect(decoded).toEqual({
      runId: "run-1",
      occurredAt: 1_700_000_000_000,
      payload: { n: 2 },
    });
  });

  it("Type matches Struct.Type (full wire payload)", () => {
    const fromStruct: typeof DemoStarted.Struct.Type = {
      runId: "run-1",
      occurredAt: 1,
      payload: { n: 1 },
    };
    const fromClass: typeof DemoStarted.Type = fromStruct;
    expect(fromClass).toBeDefined();
  });

  it("recursively materializes nested Telemetry.Schema classes", () => {
    const decoded: typeof DemoWithSnapshot.Struct.Type = Schema.decodeUnknownSync(
      DemoWithSnapshot.Struct as never,
    )({
      id: "change-1",
      changedAt: 42,
      current: {
        id: "resource-1",
        observedAt: 99,
      },
    });
    expect(decoded).toEqual({
      id: "change-1",
      changedAt: 42,
      current: {
        id: "resource-1",
        observedAt: 99,
      },
    });
  });
});
