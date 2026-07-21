import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import * as Polling from "../src/Polling";
import { Process } from "../src";

describe("Polling.cron", () => {
  it.effect(
    "ticks land on the expression's occurrences (TestClock starts at epoch)",
    () =>
      Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const proc = Process.make("test/cron-minutely", {
          effect: Ref.update(ticks, (n) => n + 1),
          polling: Polling.cron("* * * * *"),
        });
        const fib = yield* Effect.forkChild(proc.effect);

        // epoch is exactly on a boundary — the FIRST wait aims at t=60s, not t=0
        yield* TestClock.adjust(Duration.seconds(59));
        expect(yield* Ref.get(ticks)).toBe(0);
        yield* TestClock.adjust(Duration.seconds(1));
        expect(yield* Ref.get(ticks)).toBe(1);
        // and the next one at t=120s
        yield* TestClock.adjust(Duration.seconds(60));
        expect(yield* Ref.get(ticks)).toBe(2);

        yield* Fiber.interrupt(fib);
      }).pipe(Effect.provide(TestClock.layer()), Effect.scoped)
  );

  it.effect(
    "peekCadence reports time until the next occurrence; wake ends the wait early",
    () =>
      Effect.gen(function* () {
        const polling = yield* Polling.current.pipe(
          Effect.provide(Polling.cron("0 * * * *"))
        );
        // at epoch, the next top-of-hour is 60 minutes out
        expect(yield* polling.peekCadence).toEqual(
          Option.some(Duration.minutes(60))
        );
        yield* TestClock.adjust(Duration.minutes(15));
        expect(yield* polling.peekCadence).toEqual(
          Option.some(Duration.minutes(45))
        );

        const woke = yield* Ref.make(false);
        const waiting = yield* Effect.forkChild(
          polling.awaitNextTick.pipe(Effect.andThen(Ref.set(woke, true)))
        );
        yield* TestClock.adjust(Duration.minutes(1));
        expect(yield* Ref.get(woke)).toBe(false);
        yield* polling.requestWake;
        yield* TestClock.adjust(Duration.millis(0));
        yield* Fiber.join(waiting);
      }).pipe(Effect.provide(TestClock.layer()), Effect.scoped)
  );

  it("an invalid expression fails at construction, not at the first tick", () => {
    expect(() => Polling.cron("not a cron")).toThrow();
  });
});
