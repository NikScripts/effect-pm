import { describe, expect, it } from "@effect/vitest";
import { Config, Duration, Effect, Fiber, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import * as DynamicConfig from "../src/DynamicConfig";
import * as Polling from "../src/Polling";

// Each test provides its dynamic layer over the WHOLE body — the layer's scope owns the
// wake-on-swap listener fiber, so the layer must outlive every assertion.

describe("Polling.dynamic", () => {
  it.effect("reads the field per tick — a swap changes the NEXT wait's duration", () =>
    Effect.gen(function* () {
      const interval = DynamicConfig.swappable(
        Config.duration("PD1_INTERVAL").pipe(Config.withDefault(Duration.seconds(10))),
      );
      const polling = yield* Polling.current.pipe(Effect.provide(Polling.dynamic(interval)));

      // default cadence: a 10s wait completes only after 10s
      const firstDone = yield* Ref.make(false);
      const first = yield* Effect.forkChild(
        polling.awaitNextTick.pipe(Effect.andThen(Ref.set(firstDone, true))),
      );
      yield* TestClock.adjust(Duration.seconds(9));
      expect(yield* Ref.get(firstDone)).toBe(false);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* Fiber.join(first);
      expect(yield* Ref.get(firstDone)).toBe(true);

      // swap to 2s: the NEXT tick uses the new value
      yield* interval.set("2 seconds");
      const second = yield* Effect.forkChild(polling.awaitNextTick);
      yield* TestClock.adjust(Duration.seconds(2));
      yield* Fiber.join(second);
      expect(yield* polling.peekCadence).toEqual(Option.some(Duration.seconds(2)));
    }).pipe(
      Effect.provide(Layer.mergeAll(DynamicConfig.layer(), TestClock.layer())),
      Effect.scoped,
    ),
  );

  it.effect("wakes the CURRENT wait on swap when the store is present", () => {
    const interval = DynamicConfig.swappable(
      Config.duration("PD2_INTERVAL").pipe(Config.withDefault(Duration.minutes(10))),
    );
    return Effect.gen(function* () {
      const polling = yield* Polling.current;

      const woke = yield* Ref.make(false);
      const waiting = yield* Effect.forkChild(
        polling.awaitNextTick.pipe(Effect.andThen(Ref.set(woke, true))),
      );
      // let the wait begin, then swap mid-wait — the wake should end it without 10 minutes passing
      yield* TestClock.adjust(Duration.seconds(1));
      expect(yield* Ref.get(woke)).toBe(false);
      yield* interval.set("5 seconds");
      // yield to let the change-listener fiber deliver the wake
      yield* TestClock.adjust(Duration.millis(0));
      yield* Fiber.join(waiting);
      expect(yield* Ref.get(woke)).toBe(true);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Polling.dynamic(interval).pipe(Layer.provideMerge(DynamicConfig.layer())),
          TestClock.layer(),
        ),
      ),
      Effect.scoped,
    );
  });

  it.effect("without a store, reads still work — no wake subscription, R stays never", () =>
    Effect.gen(function* () {
      const interval = DynamicConfig.swappable(
        Config.duration("PD3_INTERVAL").pipe(Config.withDefault(Duration.seconds(3))),
      );
      // NOTE: no DynamicConfig.layer() provided — presence-driven subscription must not leak R
      const polling = yield* Polling.current.pipe(Effect.provide(Polling.dynamic(interval)));
      const tick = yield* Effect.forkChild(polling.awaitNextTick);
      yield* TestClock.adjust(Duration.seconds(3));
      yield* Fiber.join(tick);
    }).pipe(Effect.provide(TestClock.layer()), Effect.scoped),
  );

  it.effect("read failure uses the fallback when given", () =>
    Effect.gen(function* () {
      // no default and no env value → the read fails → fallback carries the cadence
      const broken = DynamicConfig.swappable(Config.duration("PD4_MISSING"));
      const polling = yield* Polling.current.pipe(
        Effect.provide(Polling.dynamic(broken, { fallback: Duration.seconds(7) })),
      );
      const tick = yield* Effect.forkChild(polling.awaitNextTick);
      yield* TestClock.adjust(Duration.seconds(7));
      yield* Fiber.join(tick);
      expect(yield* polling.peekCadence).toEqual(Option.some(Duration.seconds(7)));
    }).pipe(
      Effect.provide(Layer.mergeAll(DynamicConfig.layer(), TestClock.layer())),
      Effect.scoped,
    ),
  );

  it.effect("read failure without a fallback is a DEFECT, not a silent default", () =>
    Effect.gen(function* () {
      const broken = DynamicConfig.swappable(Config.duration("PD5_MISSING"));
      const polling = yield* Polling.current.pipe(Effect.provide(Polling.dynamic(broken)));
      const exit = yield* Effect.exit(polling.awaitNextTick);
      expect(exit._tag).toBe("Failure");
    }).pipe(
      Effect.provide(Layer.mergeAll(DynamicConfig.layer(), TestClock.layer())),
      Effect.scoped,
    ),
  );

  it.effect("requestWake ends the current wait (manual wake unchanged)", () =>
    Effect.gen(function* () {
      const interval = DynamicConfig.swappable(
        Config.duration("PD6_INTERVAL").pipe(Config.withDefault(Duration.minutes(5))),
      );
      const polling = yield* Polling.current.pipe(Effect.provide(Polling.dynamic(interval)));
      const ticks = yield* Ref.make(0);
      const waiting = yield* Effect.forkChild(
        polling.awaitNextTick.pipe(Effect.andThen(Ref.update(ticks, (n) => n + 1))),
      );
      yield* TestClock.adjust(Duration.seconds(1));
      yield* polling.requestWake;
      yield* TestClock.adjust(Duration.millis(0));
      yield* Fiber.join(waiting);
      expect(yield* Ref.get(ticks)).toBe(1);
    }).pipe(
      Effect.provide(Layer.mergeAll(DynamicConfig.layer(), TestClock.layer())),
      Effect.scoped,
    ),
  );
});
