import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Logger, Option } from "effect";
import { LogAnnotationKeys } from "../src/LogContext";
import type { LogEntry } from "../src/LogEntry";
import { LogQueryError } from "../src/internal/manager/logQuery";
import { StoreWriteError } from "../src/internal/store/errors";
import * as ProcessStorage from "../src/ProcessStorage";
import { LogStore, catchErrorAndLog } from "../src/store/log";
import { testBillingNodeKey, testSyncProcessKey } from "./fixtures/logKeys";

const entry = (message: string): LogEntry => ({
  date: "2026-05-22T20:00:00.000Z",
  level: "Info",
  message,
  annotations: {
    [LogAnnotationKeys.node]: testBillingNodeKey,
    [LogAnnotationKeys.processId]: testSyncProcessKey,
  },
  spans: [],
});

describe("LogStore — static optional emitters", () => {
  it.live("no-ops writes when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* LogStore.record(testBillingNodeKey, "1", entry("absent write"));
      yield* LogStore.recordBatch(testBillingNodeKey, [
        { entryId: "2", entry: entry("absent batch write") },
      ]);
      expect(true).toBe(true);
    }),
  );

  it.live("history reads require the facet service in context", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.serviceOption(LogStore).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.die("LogStore not in context"),
              onSome: (log) =>
                log.load({
                  groupId: testBillingNodeKey,
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
      yield* LogStore.record(testBillingNodeKey, "1", entry("sync tick"));
      const log = yield* LogStore;
      const loaded = yield* log.load({
        groupId: testBillingNodeKey,
        processId: testSyncProcessKey,
        limit: 10,
        sort: "desc",
      });

      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.message).toBe("sync tick");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("surfaces write failures unless explicitly caught and logged", () => {
    const captured: string[] = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      const text =
        typeof message === "string" ? message : JSON.stringify(message);
      captured.push(text);
    });
    const failingFacet: LogStore.Type = {
      record: () =>
        Effect.fail(
          new StoreWriteError({ cause: "blocked", detail: "blocked-log" }),
        ),
      recordBatch: () =>
        Effect.fail(
          new StoreWriteError({ cause: "blocked-batch", detail: "blocked-log-batch" }),
        ),
      load: () =>
        Effect.fail(
          new LogQueryError({ reason: "not used" }),
        ),
      query: () =>
        Effect.fail(
          new LogQueryError({ reason: "not used" }),
        ),
    };

    const write = LogStore.record(testBillingNodeKey, "1", entry("blocked"));
    return Effect.gen(function* () {
      const error = yield* Effect.flip(write);
      expect(error).toBeInstanceOf(StoreWriteError);
      yield* write.pipe(
        catchErrorAndLog({
          message: "test log write failed",
          annotations: { test: "log-static" },
        }),
      );
      expect(captured.some((m) => m.includes("test log write failed"))).toBe(true);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(LogStore, failingFacet as never),
          Logger.layer([captureLogger], { mergeWithExisting: false }),
        ),
      ),
    );
  });
});

describe("LogStore — phantom type accessors", () => {
  it.live(".Type and .EmitType expose the structural shapes", () =>
    Effect.sync(() => {
      const fullShape: LogStore.Type = {
        record: () => Effect.void,
        recordBatch: () => Effect.void,
        load: () => Effect.succeed([]),
        query: () => Effect.void,
      };
      const emitShape: LogStore.EmitType = {
        record: fullShape.record,
        recordBatch: fullShape.recordBatch,
      };

      expect(typeof fullShape.load).toBe("function");
      expect(typeof emitShape.recordBatch).toBe("function");
    }),
  );
});
