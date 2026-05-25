/**
 * Conformance suite for the {@link ProcessStoreProcessExecution} facet.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Logger } from "effect";
import { ProcessStore } from "../src/ProcessStore";
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
      const rows = yield* ProcessStoreProcessExecution.executions({ processId });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.execution.status).toBe("interrupted");
    }).pipe(Effect.provide(ProcessStore.layer)),
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
      const facet = yield* ProcessStoreProcessExecution;
      const rows = yield* facet.executions({ processId });
      expect(rows.map((row) => row.execution.status).sort()).toEqual([
        "completed",
        "failed",
      ]);
    }).pipe(Effect.provide(ProcessStore.layer)),
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
      const facet = yield* ProcessStoreProcessExecution;
      const onlyA = yield* facet.executions({
        processId,
        scheduleKey: "window-a",
      });
      expect(onlyA).toHaveLength(1);
      expect(onlyA[0]?.execution.scheduleKey).toBe("window-a");
    }).pipe(Effect.provide(ProcessStore.layer)),
  );

  it.live("hasPriorExecutions reflects persisted rows", () =>
    Effect.gen(function* () {
      const facet = yield* ProcessStoreProcessExecution;
      expect(yield* facet.hasPriorExecutions(processId)).toBe(false);
      yield* ProcessStoreProcessExecution.recordCompleted(finish(processId));
      expect(yield* facet.hasPriorExecutions(processId)).toBe(true);
    }).pipe(Effect.provide(ProcessStore.layer)),
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
      expect(typeof fullShape.executions).toBe("function");
      expect(typeof emitShape.recordFailed).toBe("function");
    }),
  );
});
