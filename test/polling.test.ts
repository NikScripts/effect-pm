import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { Polling } from "../src";
import { provideLayer } from "../src/provideLayer.js";

describe("Polling.spaced", () => {
  it.effect("awaitNextTick completes when TestClock advances by the spacing duration", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.gen(function* () {
          const polling = yield* Polling;
          yield* polling.awaitNextTick;
        }).pipe(provideLayer(Polling.spaced(Duration.seconds(2)))),
      );

      yield* TestClock.adjust(Duration.seconds(2));
      yield* Fiber.join(fiber);
    }).pipe(provideLayer(TestClock.layer())),
  );

  it.effect("requestWake ends the current await before the full duration elapses", () =>
    Effect.gen(function* () {
      const polling = yield* Polling;
      const waitFiber = yield* Effect.forkChild(polling.awaitNextTick);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* polling.requestWake;
      yield* Fiber.join(waitFiber);
    }).pipe(provideLayer(Polling.spaced(Duration.seconds(10)))),
  );
});

describe("Polling.accelerating", () => {
  it.effect("afterTick decreases cadence and resetCadence restores it", () =>
    Effect.gen(function* () {
      const polling = yield* Polling;

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
    }).pipe(provideLayer(Polling.acceleratingScoped({
      minIntervalMs: 100,
      maxIntervalMs: 2_000,
      decayK: 1,
    }))),
  );

  it.effect("resetCadence wakes a pending wait", () =>
    Effect.gen(function* () {
      const polling = yield* Polling;

      const waitFiber = yield* Effect.forkChild(polling.awaitNextTick);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* polling.resetCadence;
      yield* Fiber.join(waitFiber);
    }).pipe(
      provideLayer(Polling.acceleratingScoped({
        minIntervalMs: 100,
        maxIntervalMs: 60_000,
        decayK: 1,
      })),
      provideLayer(TestClock.layer()),
    ),
  );
});
