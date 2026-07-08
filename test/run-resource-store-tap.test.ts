import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Logger, pipe } from "effect";
import * as Store from "../src/Store";
import { StoreWriteError } from "../src/internal/store/errors";
import { engineRunResourceStoreContract } from "../src/internal/store/runResourceStoreSpec";
import type { RunGateStatus } from "../src/internal/runResource";

const scopeKey = "@test/failing-store";

const failingFactWrite = () =>
  Effect.fail(new StoreWriteError({ cause: "blocked-fact" }));
const failingStateWrite = () =>
  Effect.fail(new StoreWriteError({ cause: "blocked-state" }));

const failingBridge = {
  at: () =>
    Effect.succeed({
      fact: {
        append: failingFactWrite,
        read: () => Effect.succeed([]),
      },
      state: {
        append: failingStateWrite,
        read: () => Effect.succeed([]),
      },
      record: failingFactWrite,
      facts: () => Effect.succeed([]),
      recordStateChange: failingStateWrite,
      stateHistory: () => Effect.succeed([]),
      recordRunStarted: () => failingFactWrite(),
      recordRunCompleted: () => failingFactWrite(),
      recordRunFailed: () => failingFactWrite(),
      recordGateStateChange: () => failingStateWrite(),
    }),
  changes: () => Effect.die(new Error("unused in engine store tests")),
} as unknown as Store.StorageApi;

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

describe("RunResource engine store effects", () => {
  it.effect("catchWriteErrors swallows failures on every narrow write", () => {
    const captured: Array<string> = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      captured.push(String(message));
    });

    return Effect.gen(function* () {
      const storeEffects = pipe(
        Store.effects(scopeKey, engineRunResourceStoreContract(scopeKey)),
        Store.catchWriteErrors,
      );
      const storageContext = yield* Effect.context<Store.Storage>();
      const provideStorage = <A>(write: Effect.Effect<A, never, Store.Storage>) =>
        Effect.provide(write, storageContext);

      yield* provideStorage(
        storeEffects.recordRunStarted({
          id: "fact-1",
          runId: "run-1",
          occurredAt: 1,
          concurrency: 1,
        }),
      );
      yield* provideStorage(
        storeEffects.recordRunCompleted({
          id: "fact-2",
          runId: "run-1",
          occurredAt: 2,
          durationMs: 1,
        }),
      );
      yield* provideStorage(
        storeEffects.recordRunFailed({
          id: "fact-3",
          runId: "run-2",
          occurredAt: 3,
          durationMs: 1,
          cause: "boom",
        }),
      );
      yield* provideStorage(
        storeEffects.recordGateStateChange({
          id: "state-1",
          changedAt: 2,
          reason: "run-resource.run.started",
          previous: previousStatus,
          current: currentStatus,
        }),
      );

      expect(captured.some((line) => line.includes("store write failed"))).toBe(true);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Store.Storage, failingBridge),
          Logger.layer([captureLogger], { mergeWithExisting: false }),
        ),
      ),
    );
  });
});
