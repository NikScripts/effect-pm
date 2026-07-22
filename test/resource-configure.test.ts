import { describe, expect, it } from "@effect/vitest";
import { Clock, Duration, Effect, Layer, Ref } from "effect";
import * as Daemon from "../src/Daemon";
import { foldConfig } from "../src/HyperlinkConfigure";
import * as WorkPool from "../src/WorkPool";
import type { EffectContext } from "../src/WorkPool";

describe("HyperlinkConfigure", () => {
  it("foldConfig stacks partial patches and function updaters", () => {
    const base = { concurrency: 10, paused: false, label: "a" };
    const effective = foldConfig(
      base,
      { concurrency: 3 },
      (prev) => ({ ...prev, label: `${prev.label}-wrapped` }),
      { paused: true },
    );
    expect(effective).toEqual({
      concurrency: 3,
      paused: true,
      label: "a-wrapped",
    });
  });

  it("foldConfig unary effect updater wraps worker", () => {
    const base = { effect: (n: number) => n + 1, concurrency: 1 };
    const effective = foldConfig(base, {
      effect: (prev: (n: number) => number) => (n: number) => prev(n) * 2,
    });
    expect(effective.effect(3)).toBe(8);
  });

  it.effect("WorkPool.Service folds configure layer before runtime", () =>
    Effect.gen(function* () {
      const handled = yield* Ref.make(0);

      class TestQueue extends WorkPool.Service<TestQueue, number, never>()(
        "@test/ConfigureQueue",
        {
          effect: (_item: number, _ctx: EffectContext<number, never, never>) =>
            Ref.update(handled, (n) => n + 1),
          concurrency: 10,
        },
      ) {}

      const configureLayers = Layer.mergeAll(
        TestQueue.configure({ concurrency: 1 }),
        TestQueue.wrapWorker((prev) => (item: number, ctx: EffectContext<number, never, never>) =>
          prev(item, ctx).pipe(Effect.tap(() => Ref.update(handled, (n) => n + 100))),
        ),
      );

      yield* Effect.gen(function* () {
        const queue = yield* TestQueue;
        yield* queue.start;
        yield* queue.add([1]);
        while ((yield* queue.completed) < 1) {
          yield* Effect.sleep(Duration.millis(5));
        }
        expect(yield* Ref.get(handled)).toBe(101);
      }).pipe(
        Effect.provide(TestQueue.layer.pipe(Layer.provideMerge(configureLayers))),
        Effect.scoped,
      );
    }),
  );

  it.live("WorkPool.Service configure can patch rateLimit", () =>
    Effect.gen(function* () {
      const starts = yield* Ref.make(0);

      class RateLimitedQueue extends WorkPool.Service<RateLimitedQueue, number, never>()(
        "@test/ConfigureRateLimitQueue",
        {
          effect: () => Ref.update(starts, (n) => n + 1),
          concurrency: 1,
          rateLimit: { limit: 1, window: Duration.seconds(1) },
        },
      ) {}

      const t0 = yield* Clock.currentTimeMillis;

      yield* Effect.gen(function* () {
        const queue = yield* RateLimitedQueue;
        yield* queue.start;
        yield* queue.add([1, 2]);
        while ((yield* queue.completed) < 2) {
          yield* Effect.sleep(Duration.millis(5));
        }
      }).pipe(
        Effect.provide(
          RateLimitedQueue.layer.pipe(
            Layer.provideMerge(
              RateLimitedQueue.configure({
                rateLimit: { limit: 1, window: Duration.millis(60) },
              }),
            ),
          ),
        ),
        Effect.scoped,
      );

      const elapsed = (yield* Clock.currentTimeMillis) - t0;
      expect(yield* Ref.get(starts)).toBe(2);
      expect(elapsed).toBeGreaterThanOrEqual(50);
      expect(elapsed).toBeLessThan(800);
    }),
  );

  it.effect("Daemon.Service buildConfiguredDaemon applies configure patches", () =>
    Effect.scoped(
      Effect.gen(function* () {
        class Worker extends Daemon.Service<Worker>()("@test/ConfigureDaemon", {
          effect: Effect.succeed("default"),
        }) {}

        const process = yield* Worker.buildConfiguredDaemon.pipe(
          Effect.provide(
            Worker.configure((spec) => ({
              ...spec,
              effect: Effect.succeed("patched"),
            })),
          ),
        );

        expect(process.name).toBe("@test/ConfigureDaemon");
        expect(Worker.defaultSpec.effect).not.toBe(process.effect);
      }),
    ),
  );
});
