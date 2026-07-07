import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Layer, Logger } from "effect";
import { ProcessStoreReadonlyRecordError } from "../src/ProcessStoreEvent";
import { Storage, type StorageApi } from "../src/Store";
import { makeRunResourceStoreTap } from "../src/internal/runResourceStoreTap";
import type { RunGateStatus } from "../src/internal/runResource";

const scopeKey = "@test/failing-store";

const failingBridge = {
  at: () =>
    Effect.succeed({
      record: () =>
        Effect.fail(new ProcessStoreReadonlyRecordError({ id: "blocked-fact" })),
      recordStateChange: () =>
        Effect.fail(new ProcessStoreReadonlyRecordError({ id: "blocked-state" })),
      facts: () => Effect.succeed([]),
      stateHistory: () => Effect.succeed([]),
    }),
  changes: () => Effect.die(new Error("unused in tap tests")),
} as unknown as StorageApi;

const previousStatus: RunGateStatus = {
  resourceId: scopeKey,
  observedAt: 1,
  configVersion: 1,
  concurrency: 1,
  waiting: 0,
  inFlight: 0,
  completed: 0,
  failed: 0,
  interrupted: 0,
  totalDurationMs: 0,
};

const currentStatus: RunGateStatus = {
  ...previousStatus,
  observedAt: 2,
  inFlight: 1,
};

describe("makeRunResourceStoreTap", () => {
  it.effect("swallows store write failures via catchErrorAndLog", () => {
    const captured: Array<string> = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      captured.push(String(message));
    });

    return Effect.gen(function* () {
      const tap = yield* makeRunResourceStoreTap(scopeKey, scopeKey);

      yield* tap.recordRunStarted("run-1", 1, 1);
      yield* tap.recordRunCompleted("run-1", 2, 1);
      yield* tap.recordRunFailed("run-2", 3, 1, Cause.fail("boom"));
      yield* tap.recordStateChange(
        "run-resource.run.started",
        previousStatus,
        currentStatus,
      );

      expect(captured.some((line) => line.includes("RunResource store write failed"))).toBe(
        true,
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Storage, failingBridge),
          Logger.layer([captureLogger], { mergeWithExisting: false }),
        ),
      ),
    );
  });
});
