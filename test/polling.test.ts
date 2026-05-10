import { describe, it } from "@effect/vitest";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { Polling } from "../src";

describe("Polling.spaced", () => {
  it.effect("awaitNextTick completes when TestClock advances by the spacing duration", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.gen(function* () {
          const polling = yield* Polling;
          yield* polling.awaitNextTick;
        }).pipe(Effect.provide(Polling.spaced(Duration.seconds(2)))),
      );

      yield* TestClock.adjust(Duration.seconds(2));
      yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("requestWake ends the current await before the full duration elapses", () =>
    Effect.gen(function* () {
      const polling = yield* Polling;
      const waitFiber = yield* Effect.forkChild(polling.awaitNextTick);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* polling.requestWake;
      yield* Fiber.join(waitFiber);
    }).pipe(Effect.provide(Polling.spaced(Duration.seconds(10)))),
  );
});
