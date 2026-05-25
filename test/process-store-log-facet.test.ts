import { ProcessStorage } from "../src/ProcessStorage";
/**
 * Conformance suite for the {@link ProcessStoreLog} facet.
 *
 * Verifies optional static emits and service-only reads (facet tag in context).
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Logger, Option } from "effect";
import { ProcessManagerLogAnnotationKeys } from "../src/LogContext";
import type { ProcessManagerLogEntry } from "../src/LogEntry";
import { ProcessManagerLogQueryError } from "../src/internal/manager/logQuery";
import { ProcessStoreReadonlyRecordError } from "../src/ProcessStoreEvent";
import { ProcessStoreLog } from "../src/store/log";

const entry = (message: string): ProcessManagerLogEntry => ({
  date: "2026-05-22T20:00:00.000Z",
  level: "Info",
  message,
  annotations: {
    [ProcessManagerLogAnnotationKeys.groupId]: "workshop-group",
    [ProcessManagerLogAnnotationKeys.processId]: "billing/sync",
  },
  spans: [],
});

describe("ProcessStoreLog — static optional emitters", () => {
  it.live("no-ops writes when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* ProcessStoreLog.record("workshop-group", "1", entry("absent write"));
      yield* ProcessStoreLog.recordBatch("workshop-group", [
        { entryId: "2", entry: entry("absent batch write") },
      ]);
      expect(true).toBe(true);
    }),
  );

  it.live("history reads require the facet service in context", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.serviceOption(ProcessStoreLog).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.die("ProcessStoreLog not in context"),
              onSome: (log) =>
                log.load({
                  groupId: "workshop-group",
                  limit: 10,
                  sort: "desc",
                }),
            }),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.live("persists and loads through the spine when the facet is provided", () =>
    Effect.gen(function* () {
      yield* ProcessStoreLog.record("workshop-group", "1", entry("sync tick"));
      const log = yield* ProcessStoreLog;
      const loaded = yield* log.load({
        groupId: "workshop-group",
        processId: "billing/sync",
        limit: 10,
        sort: "desc",
      });

      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.message).toBe("sync tick");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("isolates write failures behind a warning log", () => {
    const captured: string[] = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      const text =
        typeof message === "string" ? message : JSON.stringify(message);
      captured.push(text);
    });
    const failingFacet: ProcessStoreLog.Type = {
      record: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-log" }),
        ),
      recordBatch: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-log-batch" }),
        ),
      load: () =>
        Effect.fail(
          new ProcessManagerLogQueryError({ reason: "not used" }),
        ),
      query: () =>
        Effect.fail(
          new ProcessManagerLogQueryError({ reason: "not used" }),
        ),
    };

    return ProcessStoreLog.record("workshop-group", "1", entry("blocked")).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ProcessStoreLog, failingFacet),
          Logger.layer([captureLogger], { mergeWithExisting: false }),
        ),
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          expect(
            captured.some((m) => m.includes("write failed for record")),
          ).toBe(true);
        }),
      ),
    );
  });
});

describe("ProcessStoreLog — phantom type accessors", () => {
  it.live(".Type and .EmitType expose the structural shapes", () =>
    Effect.sync(() => {
      const fullShape: ProcessStoreLog.Type = {
        record: () => Effect.void,
        recordBatch: () => Effect.void,
        load: () => Effect.succeed([]),
        query: () => Effect.void,
      };
      const emitShape: ProcessStoreLog.EmitType = {
        record: fullShape.record,
        recordBatch: fullShape.recordBatch,
      };

      expect(typeof fullShape.load).toBe("function");
      expect(typeof emitShape.recordBatch).toBe("function");
    }),
  );
});
