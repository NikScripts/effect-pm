import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Option, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";
import * as Polling from "../src/Polling";
import { Process } from "../src";

describe("Polling.adaptive", () => {
  it.effect("decays from active toward idle, capped", () =>
    Effect.gen(function* () {
      const polling = yield* Polling.current.pipe(
        Effect.provide(
          Polling.adaptive({
            active: Duration.seconds(1),
            idle: Duration.seconds(8),
            factor: 2,
          }),
        ),
      );
      // fresh cadence: 1s
      expect(yield* polling.peekCadence).toEqual(Option.some(Duration.seconds(1)));
      // three quiet ticks: 1s → 2s → 4s → 8s (cap)
      yield* polling.afterTick;
      expect(yield* polling.peekCadence).toEqual(Option.some(Duration.seconds(2)));
      yield* polling.afterTick;
      yield* polling.afterTick;
      expect(yield* polling.peekCadence).toEqual(Option.some(Duration.seconds(8)));
      yield* polling.afterTick;
      expect(yield* polling.peekCadence).toEqual(Option.some(Duration.seconds(8)));
    }).pipe(Effect.provide(TestClock.layer()), Effect.scoped),
  );

  it.effect("resetCadence snaps back to active AND wakes the current wait", () =>
    Effect.gen(function* () {
      const polling = yield* Polling.current.pipe(
        Effect.provide(
          Polling.adaptive({
            active: Duration.seconds(1),
            idle: Duration.minutes(10),
          }),
        ),
      );
      // decay deep into idle
      for (let i = 0; i < 12; i++) yield* polling.afterTick;
      expect(yield* polling.peekCadence).toEqual(Option.some(Duration.minutes(10)));

      const woke = yield* Ref.make(false);
      const waiting = yield* Effect.forkChild(
        polling.awaitNextTick.pipe(Effect.andThen(Ref.set(woke, true))),
      );
      yield* TestClock.adjust(Duration.seconds(1));
      expect(yield* Ref.get(woke)).toBe(false);

      yield* polling.resetCadence;
      yield* TestClock.adjust(Duration.millis(0));
      yield* Fiber.join(waiting);
      expect(yield* polling.peekCadence).toEqual(Option.some(Duration.seconds(1)));
    }).pipe(Effect.provide(TestClock.layer()), Effect.scoped),
  );

  it.effect("wakeOn: a stream element ends the wait without the interval elapsing", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0);
      const arrivals = yield* Ref.make(0);
      const proc = Process.make("test/adaptive-wake", {
        effect: Ref.update(ticks, (n) => n + 1),
        polling: Polling.adaptive({
          active: Duration.seconds(1),
          idle: Duration.minutes(10),
        }),
      });
      const fib = yield* Effect.forkChild(proc.effect);

      // arrival stream: one element after 3s — long before the (decayed) interval would fire
      const events = Stream.fromEffect(
        Effect.sleep(Duration.seconds(3)).pipe(Effect.andThen(Ref.update(arrivals, (n) => n + 1))),
      );
      yield* Polling.wakeOn(events, proc.polling.resetCadence);

      // first tick at 1s (active), then decay begins
      yield* TestClock.adjust(Duration.seconds(1));
      expect(yield* Ref.get(ticks)).toBe(1);
      // the arrival at t=3s resets + wakes → tick without waiting out the decayed interval
      yield* TestClock.adjust(Duration.seconds(2));
      yield* TestClock.adjust(Duration.millis(10));
      expect(yield* Ref.get(arrivals)).toBe(1);
      expect(yield* Ref.get(ticks)).toBe(2);

      yield* Fiber.interrupt(fib);
    }).pipe(Effect.provide(TestClock.layer()), Effect.scoped),
  );
});
