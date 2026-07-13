import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer, Stream } from "effect";
import * as Logs from "../src/Logs";
import { LogStore } from "../src/store/log";
import { testRelayNodeKey } from "./fixtures/logKeys";

describe("Logs relay", () => {
  it.live("layer captures one relay entry per log line", () =>
    Effect.gen(function* () {
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.filter(Logs.stream, (e) => e.message === "relay-once"),
            1,
          ),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* Effect.logInfo("relay-once");
      const entry = Array.from(yield* Fiber.join(collected))[0];
      expect(entry?.message).toBe("relay-once");
    }).pipe(Effect.provide(Logs.layer), Effect.scoped),
  );

  it.live("persistLayer uses relay subscription (one capture path)", () =>
    Effect.gen(function* () {
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.filter(Logs.stream, (e) => e.message === "persist-subscriber"),
            1,
          ),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* Effect.logInfo("persist-subscriber");
      const entry = Array.from(yield* Fiber.join(collected))[0];
      expect(entry?.message).toBe("persist-subscriber");
    }).pipe(
      Effect.provide(
        Logs.persistLayer(testRelayNodeKey).pipe(
          Layer.provideMerge(Layer.mergeAll(Logs.layer, LogStore.layerMemory)),
        ),
      ),
      Effect.scoped,
    ),
  );
});
