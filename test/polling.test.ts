import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { Polling } from "../src";

describe("Polling.spaced", () => {
  it.effect("awaitNextTick completes when TestClock advances by the spacing duration", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.gen(function* () {
          const polling = yield* Polling.current;
          yield* polling.awaitNextTick;
        }),
      );

      yield* TestClock.adjust(Duration.seconds(2));
      yield* Fiber.join(fiber);
    }).pipe(
      Effect.provide(Layer.mergeAll(TestClock.layer(), Polling.spaced(Duration.seconds(2)))),
    ),
  );

  it.effect("requestWake ends the current await before the full duration elapses", () =>
    Effect.gen(function* () {
      const polling = yield* Polling.current;
      const waitFiber = yield* Effect.forkChild(polling.awaitNextTick);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* polling.requestWake;
      yield* Fiber.join(waitFiber);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(Polling.spaced(Duration.seconds(10)), TestClock.layer()),
      ),
    ),
  );
});

describe("Polling.accelerating", () => {
  it.effect("afterTick decreases cadence and resetCadence restores it", () =>
    Effect.gen(function* () {
      const polling = yield* Polling.current;

      const first = yield* polling.peekCadence;
      yield* polling.afterTick;
      yield* polling.afterTick;
      const accelerated = yield* polling.peekCadence;
      yield* polling.resetCadence;
      const reset = yield* polling.peekCadence;

      const firstMs = Option.match(first, {
        onNone: () => 0,
        onSome: (dur) => Duration.toMillis(dur),
      });
      const acceleratedMs = Option.match(accelerated, {
        onNone: () => 0,
        onSome: (dur) => Duration.toMillis(dur),
      });
      const resetMs = Option.match(reset, {
        onNone: () => 0,
        onSome: (dur) => Duration.toMillis(dur),
      });

      expect(firstMs).toBeGreaterThan(acceleratedMs);
      expect(resetMs).toBe(firstMs);
    }).pipe(
      Effect.provide(
        Polling.accelerating({
          fastest: "100 millis",
          slowest: "2 seconds",
          decay: 1,
        }),
      ),
    ),
  );

  it.effect("resetCadence wakes a pending wait", () =>
    Effect.gen(function* () {
      const polling = yield* Polling.current;

      const waitFiber = yield* Effect.forkChild(polling.awaitNextTick);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* polling.resetCadence;
      yield* Fiber.join(waitFiber);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Polling.accelerating({
            fastest: "100 millis",
            slowest: "60 seconds",
            decay: 1,
          }),
          TestClock.layer(),
        ),
      ),
    ),
  );
});
