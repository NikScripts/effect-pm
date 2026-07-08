import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Logger } from "effect";
import { Storage, type StorageApi } from "../src/Store";
import { StoreWriteError } from "../src/internal/store/errors";
import { makeRunResourceHandleEffect } from "../src/internal/runResource";

const scopeKey = "@test/failing-store";

const failingBridge = {
  at: () =>
    Effect.succeed({
      record: () => Effect.fail(new StoreWriteError({ cause: "blocked-fact" })),
      recordStateChange: () => Effect.fail(new StoreWriteError({ cause: "blocked-state" })),
      facts: () => Effect.succeed([]),
      stateHistory: () => Effect.succeed([]),
      started: () => Effect.fail(new StoreWriteError({ cause: "blocked-started" })),
      completed: () => Effect.fail(new StoreWriteError({ cause: "blocked-completed" })),
      failed: () => Effect.fail(new StoreWriteError({ cause: "blocked-failed" })),
    }),
  changes: () => Effect.die(new Error("unused in store tests")),
} as unknown as StorageApi;

describe("makeRunResourceHandleEffect store writes", () => {
  it.effect("swallows StoreWriteError via Store.catchWriteErrors", () => {
    const captured: Array<string> = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      captured.push(String(message));
    });

    return Effect.gen(function* () {
      const handle = yield* makeRunResourceHandleEffect<void, void, never>({
        name: scopeKey,
        scopeKey,
        effect: () => Effect.void,
        concurrency: 1,
      });

      yield* handle.run();
      yield* handle.run();

      expect(captured.some((line) => line.includes("store write failed"))).toBe(true);
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
