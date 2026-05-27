import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer, Ref } from "effect";
import { Process } from "../src/Process";
import { foldConfig } from "../src/ResourceConfigure";
import { type EffectContext, QueueResource } from "../src/QueueResource";

describe("ResourceConfigure", () => {
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

  it.effect("QueueResource.Service folds configure layer before runtime", () =>
    Effect.gen(function* () {
      const handled = yield* Ref.make(0);

      class TestQueue extends QueueResource.Service<TestQueue, number, never>()(
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

  it.effect("Process.Service buildConfiguredProcess applies configure patches", () =>
    Effect.scoped(
      Effect.gen(function* () {
        class Worker extends Process.Service<Worker>()("@test/ConfigureProcess", {
          effect: Effect.succeed("default"),
        }) {}

        const process = yield* Worker.buildConfiguredProcess.pipe(
          Effect.provide(
            Worker.configure((spec) => ({
              ...spec,
              effect: Effect.succeed("patched"),
            })),
          ),
        );

        expect(process.name).toBe("@test/ConfigureProcess");
        expect(Worker.defaultSpec.effect).not.toBe(process.effect);
      }),
    ),
  );
});
