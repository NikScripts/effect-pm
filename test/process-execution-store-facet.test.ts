import { ProcessStorage } from "../src/ProcessStorage";
/**
 * Conformance suite for the {@link ProcessExecutionStore} facet.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Logger } from "effect";
import { ProcessStore } from "../src/ProcessStore";
import { ProcessScope } from "../src/ProcessScope";
import {
  RuntimeStorage,
  RuntimeStorageConnectionError,
  type RuntimeStorageService,
} from "../src/RuntimeStorage";
import { ProcessExecutionStore } from "../src/store/processExecution";

interface ProcessExecutionTestInput {
  readonly processId: string;
  readonly scheduleKey: string | null;
  readonly startedAt: number;
  readonly error?: unknown;
  readonly isStartupRun: boolean;
}

const finish = (processId: string, overrides: Partial<ProcessExecutionTestInput> = {}): ProcessExecutionTestInput => ({
  processId,
  scheduleKey: null,
  startedAt: 1_700_000_000_000,
  isStartupRun: false,
  ...overrides,
});

const withProcessScope = <A, E, R>(
  input: ProcessExecutionTestInput,
  effect: Effect.Effect<A, E, R>,
) =>
  ProcessScope.run({
  processId: input.processId,
  scheduleKey: input.scheduleKey,
  startedAt: input.startedAt,
  isStartupRun: input.isStartupRun,
  }, effect);

const emitCompleted = (input: ProcessExecutionTestInput) =>
  withProcessScope(input, ProcessExecutionStore.Execution.Completed);

const emitFailed = (input: ProcessExecutionTestInput) =>
  withProcessScope(
    input,
    ProcessExecutionStore.Execution.Failed(input.error ?? "failed"),
  );

const emitInterrupted = (input: ProcessExecutionTestInput) =>
  withProcessScope(input, ProcessExecutionStore.Execution.Interrupted);

const failingRuntimeStorage: RuntimeStorageService = {
  create: () =>
    Effect.fail(
      new RuntimeStorageConnectionError({
        adapter: "memory",
        operation: "create",
        cause: "expected process execution failure",
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

describe("ProcessExecutionStore — static optional emitters", () => {
  it.live("no-ops silently when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* emitCompleted(finish("test/no-layer"));
      expect(true).toBe(true);
    }),
  );

  it.live("Execution.Interrupted persists interrupted status", () =>
    Effect.gen(function* () {
      const processId = "test/interrupted";
      yield* emitInterrupted({
        processId,
        scheduleKey: "win",
        startedAt: 1_700_000_000_000,
        isStartupRun: false,
      });
      const store = yield* ProcessExecutionStore;
      const rows = yield* store.executions({ processId });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.execution.status).toBe("interrupted");
      expect(rows[0]?.type).toBe("Process.Execution.Interrupted");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("persists through the spine when the facet is provided", () =>
    Effect.gen(function* () {
      const processId = "test/present-facet";
      yield* emitCompleted(
        finish(processId, { isStartupRun: true }),
      );
      yield* emitFailed(
        finish(processId, {
          startedAt: 1_700_000_000_100,
          error: "boom",
        }),
      );
      const store = yield* ProcessExecutionStore;
      const rows = yield* store.executions({ processId });
      expect(rows.map((row) => row.execution.status).sort()).toEqual([
        "completed",
        "failed",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("logs schema write failures through the event definition", () => {
    const captured: string[] = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      const text =
        typeof message === "string" ? message : JSON.stringify(message);
      captured.push(text);
    });
    return Effect.gen(function* () {
      yield* emitCompleted(finish("test/failing"));
      expect(captured.some((m) => m.includes("ProcessExecutionStore write failed for completed run"))).toBe(true);
    }).pipe(
      Effect.provide(ProcessExecutionStore.layerRuntimeStorage),
      Effect.provideService(RuntimeStorage, failingRuntimeStorage),
      Effect.provide(Logger.layer([captureLogger], { mergeWithExisting: false })),
    );
  });
});

describe("ProcessExecutionStore — projections", () => {
  const processId = "test/projections";

  it.live("executions filters by scheduleKey when provided", () =>
    Effect.gen(function* () {
      yield* emitCompleted(
        finish(processId, { scheduleKey: "window-a", isStartupRun: true }),
      );
      yield* emitCompleted(
        finish(processId, {
          scheduleKey: "window-b",
          startedAt: 1_700_000_000_200,
        }),
      );
      const store = yield* ProcessExecutionStore;
      const onlyA = yield* store.executions({
        processId,
        scheduleKey: "window-a",
      });
      expect(onlyA).toHaveLength(1);
      expect(onlyA[0]?.execution.scheduleKey).toBe("window-a");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("hasPriorExecutions reflects persisted rows", () =>
    Effect.gen(function* () {
      const store = yield* ProcessExecutionStore;
      expect(yield* store.hasPriorExecutions(processId)).toBe(false);
      yield* emitCompleted(finish(processId));
      expect(yield* store.hasPriorExecutions(processId)).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live(
    "applies opts.limit to the post-filter result when scheduleKey is set",
    () =>
      Effect.gen(function* () {
        const pid = "test/post-filter-limit";
        for (let i = 0; i < 5; i++) {
          yield* emitCompleted(
            finish(pid, {
              scheduleKey: "hot",
              startedAt: 1_700_000_001_000 + i * 10,
            }),
          );
        }
        for (let i = 0; i < 5; i++) {
          yield* emitCompleted(
            finish(pid, {
              scheduleKey: "cold",
              startedAt: 1_700_000_002_000 + i * 10,
            }),
          );
        }
        const store = yield* ProcessExecutionStore;
        const limited = yield* store.executions({
          processId: pid,
          scheduleKey: "hot",
          opts: { limit: 2 },
        });
        expect(limited).toHaveLength(2);
        expect(limited.every((row) => row.execution.scheduleKey === "hot")).toBe(
          true,
        );
      }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("ProcessExecutionStore — for(processId) bound API", () => {
  it.live("executions() narrows to the bound processId", () =>
    Effect.gen(function* () {
      const a = "test/for/a";
      const b = "test/for/b";
      yield* emitCompleted(finish(a));
      yield* emitCompleted(finish(b));
      const boundA = yield* ProcessExecutionStore.for(a);
      const boundB = yield* ProcessExecutionStore.for(b);
      const aRows = yield* boundA.executions();
      const bRows = yield* boundB.executions();
      expect(aRows).toHaveLength(1);
      expect(aRows[0]?.entityId).toBe(a);
      expect(bRows).toHaveLength(1);
      expect(bRows[0]?.entityId).toBe(b);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("scheduleKey filter still works through the bound API", () =>
    Effect.gen(function* () {
      const pid = "test/for/scheduleKey";
      yield* emitCompleted(finish(pid, { scheduleKey: "hot" }));
      yield* emitCompleted(
        finish(pid, {
          scheduleKey: "cold",
          startedAt: 1_700_000_000_100,
        }),
      );
      const bound = yield* ProcessExecutionStore.for(pid);
      const hot = yield* bound.executions({ scheduleKey: "hot" });
      expect(hot).toHaveLength(1);
      expect(hot[0]?.execution.scheduleKey).toBe("hot");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("hasPriorExecutions() reflects the bound scope", () =>
    Effect.gen(function* () {
      const pid = "test/for/has-prior";
      const bound = yield* ProcessExecutionStore.for(pid);
      expect(yield* bound.hasPriorExecutions()).toBe(false);
      yield* emitCompleted(finish(pid));
      expect(yield* bound.hasPriorExecutions()).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("for({ id }) accepts an object identifier", () =>
    Effect.gen(function* () {
      const pid = "test/for/object-id";
      yield* emitCompleted(finish(pid));
      const bound = yield* ProcessExecutionStore.for({
        id: pid,
      });
      const rows = yield* bound.executions();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.entityId).toBe(pid);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("ProcessExecutionStore — type accessors", () => {
  it.live("ProcessStore.Type helpers expose the structural shapes", () =>
    Effect.gen(function* () {
      const failed = Object.assign(() => Effect.void, {
        batch: () => Effect.void,
      });
      const executionEmit = {
        Completed: Effect.void,
        Failed: failed,
        Interrupted: Effect.void,
      };
      const fullShape: ProcessStore.Type.Shape<typeof ProcessExecutionStore> = {
        Execution: executionEmit,
        executions: () => Effect.succeed([]),
        hasPriorExecutions: () => Effect.succeed(false),
      };
      const emitShape: ProcessStore.Type.Emit<typeof ProcessExecutionStore> = {
        Execution: executionEmit,
      };
      const boundShape: ProcessStore.Type.Identifier<typeof ProcessExecutionStore> = {
        executions: () => Effect.succeed([]),
        hasPriorExecutions: () => Effect.succeed(false),
      };
      expect(typeof fullShape.executions).toBe("function");
      expect(typeof emitShape.Execution.Completed).toBe("object");
      expect(typeof ProcessExecutionStore.Execution.Completed).toBe("object");
      expect(typeof boundShape.executions).toBe("function");
    }),
  );
});
