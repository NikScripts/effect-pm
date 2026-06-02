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

type Assert<T extends true> = T;

type IsEqual<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends
    (<T>() => T extends Right ? 1 : 2)
    ? true
    : false;

const assertType = <T extends true>(_value?: T): void => undefined;

const TelemetryTestScope = State.Scope("Process", {
  processId: Schema.String,
  subjectId: Schema.String,
  startedAt: Schema.Number,
})("@test/TelemetryTestScope");

const TelemetryTestState = TelemetryTestScope.Schema.State;

class TelemetryRecorded extends Telemetry.Schema<TelemetryRecorded>()(
  TelemetryTestScope,
)({
  subjectId: TelemetryTestState.subjectId,
  startedAt: TelemetryTestState.startedAt,
  occurredAt: Telemetry.terminal.clockMillis,
  completedAt: Telemetry.terminal.clockMillis,
  durationMs: Telemetry.terminal.durationMs,
  payload: Schema.Struct({
    concurrency: Schema.Number,
  }),
}) {}

class TelemetryFailed extends Telemetry.Schema<TelemetryFailed>()(
  TelemetryTestScope,
)({
  subjectId: TelemetryTestState.subjectId,
  occurredAt: Telemetry.terminal.clockMillis,
  error: Telemetry.input.errorString,
}) {}

const TelemetrySchemaTelemetry = ProcessStore.telemetry(
  TelemetryTestScope,
)(
  Telemetry.namespace("Test"),
  Telemetry.tag("Event")(
    Telemetry.event("Recorded", TelemetryRecorded).pipe(
      Telemetry.index(({ field }) => ({
        subjectType: "TelemetrySubject",
        subjectId: field("subjectId"),
        indexA: field("subjectId").named("subjectId"),
      })),
      Telemetry.logWarning(
        ({ subjectId }) => `schema write failed for ${String(subjectId)}`,
        ({ subjectId }) => ({
          subjectId: String(subjectId),
        }),
      ),
    ),
    Telemetry.event("Failed", TelemetryFailed),
  ),
);

class TelemetrySchemaStore extends ProcessStore.Service<TelemetrySchemaStore>()(
  "@test/TelemetrySchemaStore",
  TelemetrySchemaTelemetry,
  ProcessStore.query((s) => ({
    records: () =>
      s.read(runtimeRecordQuery([Type.equals("Test.Event.Recorded")], undefined)),
    failed: () =>
      s.read(runtimeRecordQuery([Type.equals("Test.Event.Failed")], undefined)),
  })),
) {}

assertType<
  Assert<
    IsEqual<
      Telemetry.Type.Wire<typeof TelemetrySchemaTelemetry>,
      "Test.Event.Recorded" | "Test.Event.Failed"
    >
  >
>();
assertType<
  Assert<
    IsEqual<
      Telemetry.Type.Event<typeof TelemetrySchemaTelemetry, "Event">,
      "Test.Event.Recorded" | "Test.Event.Failed"
    >
  >
>();
assertType<
  Assert<
    IsEqual<Telemetry.Type.Event<typeof TelemetrySchemaTelemetry, "Missing">, never>
  >
>();
assertType<
  Assert<
    typeof TelemetrySchemaStore.Event.Recorded extends (
      input: unknown,
    ) => Effect.Effect<void, unknown, unknown>
      ? true
      : false
  >
>();
assertType<
  Assert<
    typeof TelemetrySchemaStore.Event.Recorded extends {
      readonly batch: (
        inputs: ReadonlyArray<unknown>,
      ) => Effect.Effect<void, unknown, unknown>;
    }
      ? true
      : false
  >
>();
assertType<
  Assert<
    typeof TelemetrySchemaStore.Event.Failed extends (
      input: unknown,
    ) => Effect.Effect<void, unknown, unknown>
      ? true
      : false
  >
>();
assertType<
  Assert<
    typeof TelemetrySchemaStore.Event.Failed extends {
      readonly batch: (
        inputs: ReadonlyArray<unknown>,
      ) => Effect.Effect<void, unknown, unknown>;
    }
      ? true
      : false
  >
>();

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
  it("exposes literal PascalCase telemetry wire metadata", () => {
    expect(Telemetry.events(TelemetrySchemaTelemetry)).toEqual([
      "Test.Event.Recorded",
      "Test.Event.Failed",
    ]);
    expect(Telemetry.events(TelemetrySchemaTelemetry, "Event")).toEqual([
      "Test.Event.Recorded",
      "Test.Event.Failed",
    ]);
    expect(Telemetry.events(TelemetrySchemaTelemetry, "Missing")).toEqual([]);
  });

  it.live("materializes scope, terminal, and literal fields into a runtime row", () =>
    Effect.gen(function* () {
      yield* TelemetrySchemaStore.Event.Recorded({
        payload: { concurrency: 2 },
      });
      const store = yield* TelemetrySchemaStore;
      const rows = yield* store.records();

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.type).toBe("Test.Event.Recorded");
      expect(row.processType).toBe("Process");
      expect(row.processId).toBe("process-1");
      expect(row.subjectType).toBe("TelemetrySubject");
      expect(row.subjectId).toBe("subject-1");
      expect(row.indexA).toBe("subject-1");
      expect(row.indexNames).toEqual(["subjectId"]);
      expect(row.payload).toMatchObject({
        subjectId: "subject-1",
        payload: { concurrency: 2 },
        startedAt: 1_700_000_000_000,
        completedAt: expect.any(Number),
        durationMs: expect.any(Number),
      });
      expect(row.occurredAt).toBeDefined();
    }).pipe(
      Effect.provide(TelemetrySchemaStore.layer),
      Effect.provide(TelemetryTestScope.layer({
        processId: "process-1",
        subjectId: "subject-1",
        startedAt: 1_700_000_000_000,
      })),
    ),
  );

  it.live("materializes input fields into function-shaped emitters", () =>
    Effect.gen(function* () {
      yield* TelemetrySchemaStore.Event.Failed(new Error("boom"));
      const store = yield* TelemetrySchemaStore;
      const rows = yield* store.failed();

      expect(rows).toHaveLength(1);
      expect(rows[0]?.processId).toBe("process-input");
      expect(rows[0]?.payload).toMatchObject({
        subjectId: "subject-input",
        error: "Error: boom",
      });
    }).pipe(
      Effect.provide(TelemetrySchemaStore.layer),
      Effect.provide(TelemetryTestScope.layer({
        processId: "process-input",
        subjectId: "subject-input",
        startedAt: 1_700_000_000_000,
      })),
    ),
  );

  it.live("batch writes input-shaped schema events", () =>
    Effect.gen(function* () {
      yield* TelemetrySchemaStore.Event.Failed.batch([
        new Error("boom-1"),
        "boom-2",
      ]);
      const store = yield* TelemetrySchemaStore;
      const rows = yield* store.failed();

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.payload)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ error: "Error: boom-1" }),
          expect.objectContaining({ error: "boom-2" }),
        ]),
      );
    }).pipe(
      Effect.provide(TelemetrySchemaStore.layer),
      Effect.provide(TelemetryTestScope.layer({
        processId: "process-batch",
        subjectId: "subject-batch",
        startedAt: 1_700_000_000_000,
      })),
    ),
  );

  it.live("logWarning catches schema write failures and logs event annotations", () => {
    const captured: string[] = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      captured.push(typeof message === "string" ? message : JSON.stringify(message));
    });

    return Effect.gen(function* () {
      yield* TelemetrySchemaStore.Event.Recorded({
        payload: { concurrency: 1 },
      });
      expect(captured.some((message) => message.includes("schema write failed for subject-2"))).toBe(true);
    }).pipe(
      Effect.provide(TelemetrySchemaStore.layerRuntimeStorage),
      Effect.provideService(RuntimeStorage, failingRuntimeStorage),
      Effect.provide(TelemetryTestScope.layer({
        processId: "process-2",
        subjectId: "subject-2",
        startedAt: 1_700_000_000_000,
      })),
      Effect.provide(Logger.layer([captureLogger], { mergeWithExisting: false })),
    );
  });
});
