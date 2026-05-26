import { ProcessStorage } from "../src/ProcessStorage";
/**
 * Conformance suite for the {@link ProcessStoreProcessExecution} facet.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Logger } from "effect";
import { ProcessStoreProcessExecution } from "../src/store/processExecution";
import type { ProcessExecutionFinishInput } from "../src/store/processExecution";
import { ProcessStoreReadonlyRecordError } from "../src/ProcessStoreEvent";

const finish = (
  processId: string,
  overrides: Partial<ProcessExecutionFinishInput> = {},
): ProcessExecutionFinishInput => ({
  processId,
  scheduleKey: null,
  startedAt: 1_700_000_000_000,
  completedAt: 1_700_000_000_010,
  isStartupRun: false,
  ...overrides,
});

describe("ProcessStoreProcessExecution — static optional emitters", () => {
  it.live("no-ops silently when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* ProcessStoreProcessExecution.recordCompleted(
        finish("test/no-layer"),
      );
      expect(true).toBe(true);
    }),
  );

  it.live("recordInterrupted persists interrupted status", () =>
    Effect.gen(function* () {
      const processId = "test/interrupted";
      yield* ProcessStoreProcessExecution.recordInterrupted({
        processId,
        scheduleKey: "win",
        startedAt: 1_700_000_000_000,
        completedAt: 1_700_000_000_005,
        isStartupRun: false,
      });
      const store = yield* ProcessStoreProcessExecution;
      const rows = yield* store.executions({ processId });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.execution.status).toBe("interrupted");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("persists through the spine when the facet is provided", () =>
    Effect.gen(function* () {
      const processId = "test/present-facet";
      yield* ProcessStoreProcessExecution.recordCompleted(
        finish(processId, { isStartupRun: true }),
      );
      yield* ProcessStoreProcessExecution.recordFailed(
        finish(processId, {
          startedAt: 1_700_000_000_100,
          completedAt: 1_700_000_000_120,
          error: "boom",
        }),
      );
      const store = yield* ProcessStoreProcessExecution;
      const rows = yield* store.executions({ processId });
      expect(rows.map((row) => row.execution.status).sort()).toEqual([
        "completed",
        "failed",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("isolates write failures behind a warning log", () => {
    const captured: string[] = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      const text =
        typeof message === "string" ? message : JSON.stringify(message);
      captured.push(text);
    });
    const failingFacet: ProcessStoreProcessExecution.Type = {
      recordCompleted: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-completed" }),
        ),
      recordFailed: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-failed" }),
        ),
      recordInterrupted: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-interrupted" }),
        ),
      executions: () => Effect.succeed([]),
      hasPriorExecutions: () => Effect.succeed(false),
    };
    return ProcessStoreProcessExecution.recordCompleted(
      finish("test/failing"),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ProcessStoreProcessExecution, failingFacet),
          Logger.layer([captureLogger], { mergeWithExisting: false }),
        ),
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          expect(
            captured.some((m) =>
              m.includes("write failed for recordCompleted"),
            ),
          ).toBe(true);
        }),
      ),
    );
  });
});

describe("ProcessStoreProcessExecution — projections", () => {
  const processId = "test/projections";

  it.live("executions filters by scheduleKey when provided", () =>
    Effect.gen(function* () {
      yield* ProcessStoreProcessExecution.recordCompleted(
        finish(processId, { scheduleKey: "window-a", isStartupRun: true }),
      );
      yield* ProcessStoreProcessExecution.recordCompleted(
        finish(processId, {
          scheduleKey: "window-b",
          startedAt: 1_700_000_000_200,
          completedAt: 1_700_000_000_210,
        }),
      );
      const store = yield* ProcessStoreProcessExecution;
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
      const store = yield* ProcessStoreProcessExecution;
      expect(yield* store.hasPriorExecutions(processId)).toBe(false);
      yield* ProcessStoreProcessExecution.recordCompleted(finish(processId));
      expect(yield* store.hasPriorExecutions(processId)).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live(
    "applies opts.limit to the post-filter result when scheduleKey is set",
    () =>
      Effect.gen(function* () {
        const pid = "test/post-filter-limit";
        // Hot rows are *older* than cold rows. Pre-fix `limit=2` over the
        // pre-filter stream returns the two newest rows (cold), so the
        // post-filter for "hot" yields zero. Post-fix the storage query
        // strips `limit` and the post-filter result is sliced to 2.
        for (let i = 0; i < 5; i++) {
          yield* ProcessStoreProcessExecution.recordCompleted(
            finish(pid, {
              scheduleKey: "hot",
              startedAt: 1_700_000_001_000 + i * 10,
              completedAt: 1_700_000_001_005 + i * 10,
            }),
          );
        }
        for (let i = 0; i < 5; i++) {
          yield* ProcessStoreProcessExecution.recordCompleted(
            finish(pid, {
              scheduleKey: "cold",
              startedAt: 1_700_000_002_000 + i * 10,
              completedAt: 1_700_000_002_005 + i * 10,
            }),
          );
        }
        const store = yield* ProcessStoreProcessExecution;
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

describe("ProcessStoreProcessExecution — for(processId) bound API", () => {
  it.live("executions() narrows to the bound processId", () =>
    Effect.gen(function* () {
      const a = "test/for/a";
      const b = "test/for/b";
      yield* ProcessStoreProcessExecution.recordCompleted(finish(a));
      yield* ProcessStoreProcessExecution.recordCompleted(finish(b));
      const boundA = yield* ProcessStoreProcessExecution.for(a);
      const boundB = yield* ProcessStoreProcessExecution.for(b);
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
      yield* ProcessStoreProcessExecution.recordCompleted(
        finish(pid, { scheduleKey: "hot" }),
      );
      yield* ProcessStoreProcessExecution.recordCompleted(
        finish(pid, {
          scheduleKey: "cold",
          startedAt: 1_700_000_000_100,
          completedAt: 1_700_000_000_110,
        }),
      );
      const bound = yield* ProcessStoreProcessExecution.for(pid);
      const hot = yield* bound.executions({ scheduleKey: "hot" });
      expect(hot).toHaveLength(1);
      expect(hot[0]?.execution.scheduleKey).toBe("hot");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("hasPriorExecutions() reflects the bound scope", () =>
    Effect.gen(function* () {
      const pid = "test/for/has-prior";
      const bound = yield* ProcessStoreProcessExecution.for(pid);
      expect(yield* bound.hasPriorExecutions()).toBe(false);
      yield* ProcessStoreProcessExecution.recordCompleted(finish(pid));
      expect(yield* bound.hasPriorExecutions()).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("withIdentifier({ id }) accepts an object identifier", () =>
    Effect.gen(function* () {
      const pid = "test/for/object-id";
      yield* ProcessStoreProcessExecution.recordCompleted(finish(pid));
      const bound = yield* ProcessStoreProcessExecution.withIdentifier({
        id: pid,
      });
      const rows = yield* bound.executions();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.entityId).toBe(pid);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("bound recordCompleted/Failed/Interrupted persist with the bound id", () =>
    Effect.gen(function* () {
      const pid = "test/for/bound-writes";
      const bound = yield* ProcessStoreProcessExecution.for(pid);
      yield* bound.recordCompleted({
        scheduleKey: null,
        startedAt: 1_700_000_000_000,
        completedAt: 1_700_000_000_010,
        isStartupRun: false,
      });
      yield* bound.recordFailed({
        scheduleKey: null,
        startedAt: 1_700_000_000_100,
        completedAt: 1_700_000_000_120,
        isStartupRun: false,
        error: "boom",
      });
      yield* bound.recordInterrupted({
        scheduleKey: null,
        startedAt: 1_700_000_000_200,
        completedAt: 1_700_000_000_205,
        isStartupRun: false,
      });
      const rows = yield* bound.executions();
      expect(rows.every((row) => row.entityId === pid)).toBe(true);
      expect(rows.map((row) => row.execution.status).sort()).toEqual([
        "completed",
        "failed",
        "interrupted",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("ProcessStoreProcessExecution — phantom type accessors", () => {
  it.live(".Type and .EmitType expose the structural shapes", () =>
    Effect.gen(function* () {
      const fullShape: ProcessStoreProcessExecution.Type = {
        recordCompleted: () => Effect.void,
        recordFailed: () => Effect.void,
        recordInterrupted: () => Effect.void,
        executions: () => Effect.succeed([]),
        hasPriorExecutions: () => Effect.succeed(false),
      };
      const emitShape: ProcessStoreProcessExecution.EmitType = {
        recordCompleted: fullShape.recordCompleted,
        recordFailed: fullShape.recordFailed,
        recordInterrupted: fullShape.recordInterrupted,
      };
      const boundShape: ProcessStoreProcessExecution.IdentifierType = {
        executions: () => Effect.succeed([]),
        hasPriorExecutions: () => Effect.succeed(false),
        recordCompleted: () => Effect.void,
        recordFailed: () => Effect.void,
        recordInterrupted: () => Effect.void,
      };
      expect(typeof fullShape.executions).toBe("function");
      expect(typeof emitShape.recordFailed).toBe("function");
      expect(typeof boundShape.executions).toBe("function");
    }),
  );
});
