/**
 * Fleet rate-limit semantics — shared {@link RateLimiterStore} across gate
 * scopes (stand-in for Redis / multi-node). Soft memory per scope is the
 * single-node path and intentionally does *not* share a budget.
 */
import { it, describe, expect } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import {
  RateLimiterStore,
  layer as rateLimiterServiceLayer,
  layerStoreMemory as rateLimiterStoreMemory,
} from "effect/unstable/persistence/RateLimiter";
import * as Gate from "../src/Gate";
import * as Store from "../src/Store";
import * as WorkPool from "../src/WorkPool";

const fleetLayers = Layer.mergeAll(
  Store.layerDefaultMemory,
  rateLimiterStoreMemory,
  TestClock.layer(),
);

const softLayers = Layer.mergeAll(Store.layerDefaultMemory, TestClock.layer());

describe("Gate fleet rateLimit", () => {
  it.effect("shared RateLimiterStore enforces one budget across two gate scopes", () =>
    Effect.gen(function* () {
      const starts = yield* Ref.make(0);
      const rateLimit = {
        key: "fleet/shared-api",
        limit: 1,
        window: Duration.seconds(1),
      } as const;

      // Two scopes ≈ two nodes; same ambient store ≈ Redis.
      const east = yield* Gate.make({
        name: "@test/fleet-east",
        concurrency: 10,
        rateLimit,
        effect: (_: void) => Ref.update(starts, (n) => n + 1),
      });
      const west = yield* Gate.make({
        name: "@test/fleet-west",
        concurrency: 10,
        rateLimit,
        effect: (_: void) => Ref.update(starts, (n) => n + 1),
      });

      expect((yield* Effect.serviceOption(RateLimiterStore))._tag).toBe("Some");

      const f1 = yield* Effect.forkChild(east.run());
      const f2 = yield* Effect.forkChild(west.run());
      yield* Effect.yieldNow;
      // One shared token — only one run may start before the window advances.
      expect(yield* Ref.get(starts)).toBe(1);

      yield* TestClock.adjust(Duration.seconds(1));
      yield* Fiber.join(f1);
      yield* Fiber.join(f2);
      expect(yield* Ref.get(starts)).toBe(2);
    }).pipe(Effect.provide(fleetLayers), Effect.scoped),
  );

  it.effect("Soft memory per scope does not share a budget (N× limit)", () =>
    Effect.gen(function* () {
      const starts = yield* Ref.make(0);
      const rateLimit = {
        key: "fleet/soft-lie",
        limit: 1,
        window: Duration.seconds(60),
        onExceeded: "fail" as const,
      };

      const east = yield* Gate.make({
        name: "@test/soft-east",
        concurrency: 10,
        rateLimit,
        effect: (_: void) => Ref.update(starts, (n) => n + 1),
      });
      const west = yield* Gate.make({
        name: "@test/soft-west",
        concurrency: 10,
        rateLimit,
        effect: (_: void) => Ref.update(starts, (n) => n + 1),
      });

      // No ambient store — each gate Soft-builds its own memory store.
      expect((yield* Effect.serviceOption(RateLimiterStore))._tag).toBe("None");

      yield* east.run();
      yield* west.run();
      // Same key, but separate Soft stores → both succeed (fleet lie).
      expect(yield* Ref.get(starts)).toBe(2);
    }).pipe(Effect.provide(softLayers), Effect.scoped),
  );

  it.effect("ambient RateLimiter.layer + store is reused by both scopes", () =>
    Effect.gen(function* () {
      const starts = yield* Ref.make(0);
      const rateLimit = {
        key: "fleet/ambient-limiter",
        limit: 1,
        window: Duration.seconds(1),
      } as const;

      const east = yield* Gate.make({
        name: "@test/ambient-east",
        concurrency: 10,
        rateLimit,
        effect: (_: void) => Ref.update(starts, (n) => n + 1),
      });
      const west = yield* Gate.make({
        name: "@test/ambient-west",
        concurrency: 10,
        rateLimit,
        effect: (_: void) => Ref.update(starts, (n) => n + 1),
      });

      const f1 = yield* Effect.forkChild(east.run());
      const f2 = yield* Effect.forkChild(west.run());
      yield* Effect.yieldNow;
      expect(yield* Ref.get(starts)).toBe(1);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* Fiber.join(f1);
      yield* Fiber.join(f2);
      expect(yield* Ref.get(starts)).toBe(2);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Store.layerDefaultMemory,
          Layer.provide(rateLimiterServiceLayer, rateLimiterStoreMemory),
          TestClock.layer(),
        ),
      ),
      Effect.scoped,
    ),
  );
});

describe("WorkPool fleet rateLimit", () => {
  it.effect("shared RateLimiterStore enforces one budget across two queues", () =>
    Effect.gen(function* () {
      const starts = yield* Ref.make(0);
      const rateLimit = {
        key: "fleet/queue-api",
        limit: 1,
        window: Duration.seconds(1),
      } as const;

      const east = yield* WorkPool.make({
        name: "@test/fleet-queue-east",
        concurrency: 4,
        rateLimit,
        effect: () => Ref.update(starts, (n) => n + 1),
      });
      const west = yield* WorkPool.make({
        name: "@test/fleet-queue-west",
        concurrency: 4,
        rateLimit,
        effect: () => Ref.update(starts, (n) => n + 1),
      });

      yield* east.add(1);
      yield* west.add(1);
      yield* Effect.yieldNow;
      // Shared store + limit 1 → only one worker start before the window.
      expect(yield* Ref.get(starts)).toBe(1);

      yield* TestClock.adjust(Duration.seconds(1));
      yield* Effect.yieldNow;
      // Drain remaining work.
      yield* Effect.sleep(Duration.millis(0));
      yield* TestClock.adjust(Duration.millis(1));
      expect(yield* Ref.get(starts)).toBe(2);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(rateLimiterStoreMemory, TestClock.layer()),
      ),
      Effect.scoped,
    ),
  );
});
