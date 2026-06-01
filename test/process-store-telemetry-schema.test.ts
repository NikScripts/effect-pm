import { describe, expect, it } from "@effect/vitest";
import { Effect, Logger, Schema } from "effect";
import { ProcessStore, Telemetry } from "../src/ProcessStore";
import {
  RuntimeStorage,
  RuntimeStorageConnectionError,
  type RuntimeStorageService,
} from "../src/RuntimeStorage";
import { State } from "../src/State";
import { runtimeRecordQuery } from "../src/internal/store/helpers";
import { Type } from "../src/Query";

class TelemetryTestScope extends State.Scope<TelemetryTestScope>()({
  processId: Schema.String,
  subjectId: Schema.String,
})("@test/TelemetryTestScope") {}

const TelemetryTestState = TelemetryTestScope.Schema.State;

class TelemetryRecorded extends Telemetry.Schema<TelemetryRecorded>()(
  TelemetryTestScope,
)({
  processId: TelemetryTestState.processId,
  subjectId: TelemetryTestState.subjectId,
  occurredAt: Telemetry.terminal.clockMillis,
  kind: Schema.Literal("recorded"),
}) {}

class TelemetrySchemaStore extends ProcessStore.Service<TelemetrySchemaStore>()(
  "@test/TelemetrySchemaStore",
  ProcessStore.telemetry(
    Telemetry.namespace("Test"),
    Telemetry.tag("Event")(
      Telemetry.event("Recorded", TelemetryRecorded).pipe(
        Telemetry.logWarning(
          ({ processId }) => `schema write failed for ${String(processId)}`,
          ({ processId, subjectId }) => ({
            processId: String(processId),
            subjectId: String(subjectId),
          }),
        ),
      ),
    ),
  ),
  ProcessStore.query((s) => ({
    records: () =>
      s.read(runtimeRecordQuery([Type.equals("Test.Event.Recorded")], undefined)),
  })),
) {}

const failingRuntimeStorage: RuntimeStorageService = {
  create: () =>
    Effect.fail(
      new RuntimeStorageConnectionError({
        adapter: "memory",
        operation: "create",
        cause: "expected test failure",
      }),
    ),
  read: () => Effect.succeed([]),
  upsert: () =>
    Effect.fail(
      new RuntimeStorageConnectionError({ adapter: "memory", operation: "upsert" }),
    ),
  update: () =>
    Effect.fail(
      new RuntimeStorageConnectionError({ adapter: "memory", operation: "update" }),
    ),
  delete: () =>
    Effect.fail(
      new RuntimeStorageConnectionError({ adapter: "memory", operation: "delete" }),
    ),
  transaction: (effect) =>
    Effect.provideService(effect, RuntimeStorage, failingRuntimeStorage),
};

describe("ProcessStore telemetry schema", () => {
  it.live("materializes scope, terminal, and literal fields into a runtime row", () =>
    Effect.gen(function* () {
      yield* TelemetrySchemaStore.Event.Recorded;
      const store = yield* TelemetrySchemaStore;
      const rows = yield* store.records();

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.type).toBe("Test.Event.Recorded");
      expect(row.processType).toBe("telemetry");
      expect(row.processId).toBe("process-1");
      expect(row.payload).toMatchObject({
        processId: "process-1",
        subjectId: "subject-1",
        kind: "recorded",
      });
      expect(row.occurredAt).toBeDefined();
    }).pipe(
      Effect.provide(TelemetrySchemaStore.layer),
      Effect.provide(TelemetryTestScope.layer({
        processId: "process-1",
        subjectId: "subject-1",
      })),
    ),
  );

  it.live("logWarning catches schema write failures and logs event annotations", () => {
    const captured: string[] = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      captured.push(typeof message === "string" ? message : JSON.stringify(message));
    });

    return Effect.gen(function* () {
      yield* TelemetrySchemaStore.Event.Recorded;
      expect(captured.some((message) => message.includes("schema write failed for process-2"))).toBe(true);
    }).pipe(
      Effect.provide(TelemetrySchemaStore.layerRuntimeStorage),
      Effect.provideService(RuntimeStorage, failingRuntimeStorage),
      Effect.provide(TelemetryTestScope.layer({
        processId: "process-2",
        subjectId: "subject-2",
      })),
      Effect.provide(Logger.layer([captureLogger], { mergeWithExisting: false })),
    );
  });
});
