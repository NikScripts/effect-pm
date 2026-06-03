import { ProcessStorage } from "../src/ProcessStorage";
/**
 * Conformance suite for the {@link LogStore} facet.
 *
 * Verifies optional static emits and service-only reads (facet tag in context).
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Logger, Option } from "effect";
import { ProcessManagerLogAnnotationKeys } from "../src/LogContext";
import type { ProcessManagerLogEntry } from "../src/LogEntry";
import { LogScope } from "../src/LogScope";
import { ProcessStore } from "../src/ProcessStore";
import { ProcessStoreReadonlyRecordError } from "../src/ProcessStoreEvent";
import {
  RuntimeStorage,
  RuntimeStorageConnectionError,
  type RuntimeStorageService,
} from "../src/RuntimeStorage";
import { LogStore } from "../src/store/log";

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

describe("LogStore — static optional emitters", () => {
  it.live("no-ops writes when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* LogScope.run(
        { groupId: "workshop-group" },
        LogStore.Entry.Recorded({ entryId: "1", entry: entry("absent write") }),
      );
      yield* LogScope.run(
        { groupId: "workshop-group" },
        LogStore.Entry.Recorded.batch([
          { entryId: "2", entry: entry("absent batch write") },
        ]),
      );
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
      yield* LogScope.run(
        { groupId: "workshop-group" },
        LogStore.Entry.Recorded({ entryId: "1", entry: entry("sync tick") }),
      );
      const log = yield* LogStore;
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

  it.live("logWarning absorbs write failures and surfaces them as log messages", () => {
    const captured: string[] = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      const text = typeof message === "string" ? message : JSON.stringify(message);
      captured.push(text);
    });
    const failingStorage: RuntimeStorageService = {
      create: () => Effect.fail(new RuntimeStorageConnectionError({ adapter: "memory", operation: "create", cause: "test" })),
      read: () => Effect.succeed([]),
      upsert: () => Effect.fail(new RuntimeStorageConnectionError({ adapter: "memory", operation: "upsert" })),
      update: () => Effect.fail(new RuntimeStorageConnectionError({ adapter: "memory", operation: "update" })),
      delete: () => Effect.fail(new RuntimeStorageConnectionError({ adapter: "memory", operation: "delete" })),
      transaction: (effect) => Effect.provideService(effect, RuntimeStorage, failingStorage),
    };
    const write = LogScope.run(
      { groupId: "workshop-group" },
      LogStore.Entry.Recorded({ entryId: "1", entry: entry("blocked") }),
    );
    return Effect.gen(function* () {
      const result = yield* Effect.exit(write);
      expect(result._tag).toBe("Success");
      expect(captured.some((m) => m.includes("LogStore write failed for log entry"))).toBe(true);
      yield* Effect.fail(new ProcessStoreReadonlyRecordError({ id: "test-only" })).pipe(
        ProcessStore.catchErrorAndLog({
          message: "test log write failed",
          annotations: { test: "log-static" },
        }),
      );
      expect(captured.some((m) => m.includes("test log write failed"))).toBe(true);
    }).pipe(
      Effect.provide(LogStore.layerRuntimeStorage),
      Effect.provideService(RuntimeStorage, failingStorage),
      Effect.provide(Logger.layer([captureLogger], { mergeWithExisting: false })),
    );
  });
});

describe("LogStore — type accessors", () => {
  it.live("ProcessStore.Type helpers expose the structural shapes", () =>
    Effect.sync(() => {
      const recorded = Object.assign(
        (_input: unknown) => Effect.void,
        { batch: (_inputs: ReadonlyArray<unknown>) => Effect.void },
      );
      const fullShape: ProcessStore.Type.Shape<typeof LogStore> = {
        Entry: { Recorded: recorded },
        load: () => Effect.succeed([]),
        query: () => Effect.void,
      };
      const emitShape: ProcessStore.Type.Emit<typeof LogStore> = {
        Entry: fullShape.Entry,
      };

      expect(typeof fullShape.load).toBe("function");
      expect(typeof emitShape.Entry.Recorded).toBe("function");
    }),
  );
});
