import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Process, Polling } from "../src";

// The handle's cadence controls — wake/resetCadence reach the RUNNING supervisor's polling
// service through the polling mirror, same ownership story as the status mirror.
describe("Process handle polling controls", () => {
  it.effect("wake ends the current wait — the next tick runs without the interval elapsing", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0);
      const proc = Process.make("test/polling-wake", {
        effect: Ref.update(ticks, (n) => n + 1),
        polling: Polling.spaced(Duration.minutes(10)),
      });

      const fib = yield* Effect.forkChild(proc.effect);
      // let the driver arm and enter its wait; no tick inside the first second
      yield* TestClock.adjust(Duration.seconds(1));
      expect(yield* Ref.get(ticks)).toBe(0);

      yield* proc.polling.wake;
      yield* TestClock.adjust(Duration.millis(10));
      expect(yield* Ref.get(ticks)).toBe(1);

      yield* Fiber.interrupt(fib);
    }).pipe(Effect.provide(TestClock.layer()), Effect.scoped),
  );

  it.effect("resetCadence returns backoff to its initial interval (and wakes)", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0);
      const proc = Process.make("test/polling-reset", {
        effect: Ref.update(ticks, (n) => n + 1),
        polling: Polling.backoff({
          initial: Duration.seconds(1),
          max: Duration.minutes(30),
          factor: 10,
        }),
      });

      const fib = yield* Effect.forkChild(proc.effect);
      // tick 1 after 1s, tick 2 after 10s more — backoff has grown to 100s
      yield* TestClock.adjust(Duration.seconds(1));
      yield* TestClock.adjust(Duration.seconds(10));
      expect(yield* Ref.get(ticks)).toBe(2);

      // without the reset the next wait would be 100s; reset wakes (tick 3 now) and restarts
      // the ladder — afterTick advances it one step, so the following wait is 10s, not 100s
      yield* proc.polling.resetCadence;
      yield* TestClock.adjust(Duration.millis(10));
      expect(yield* Ref.get(ticks)).toBe(3);
      yield* TestClock.adjust(Duration.seconds(10));
      expect(yield* Ref.get(ticks)).toBe(4);

      yield* Fiber.interrupt(fib);
    }).pipe(Effect.provide(TestClock.layer()), Effect.scoped),
  );

  it.effect("controls are no-ops while the driver isn't supervising", () =>
    Effect.gen(function* () {
      const proc = Process.make("test/polling-idle", {
        effect: Effect.void,
        polling: Polling.spaced(Duration.seconds(5)),
      });
      // driver never forked — both verbs succeed as no-ops
      yield* proc.polling.wake;
      yield* proc.polling.resetCadence;
    }).pipe(Effect.provide(TestClock.layer()), Effect.scoped),
  );
});
