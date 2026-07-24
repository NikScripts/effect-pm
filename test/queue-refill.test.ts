import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Ref } from "effect";
import * as WorkPool from "../src/WorkPool";

const waitUntil = (predicate: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    while (!(yield* predicate)) yield* Effect.sleep(Duration.millis(10));
  }).pipe(Effect.timeout(Duration.seconds(2)));

describe("WorkPool refill", () => {
  it.live("refill.onStart bootstraps the queue from a source", () =>
    (Effect.gen(function* () {
      const processed = yield* Ref.make<Array<number>>([]);
      yield* WorkPool.make({
        name: "refill-start",
        effect: (n: number) => Ref.update(processed, (a) => [...a, n]),
        refill: { onStart: true, load: (q) => q.add([1, 2, 3]) },
        concurrency: 2,
      });
      yield* waitUntil(Effect.map(Ref.get(processed), (p) => p.length >= 3));
      expect((yield* Ref.get(processed)).sort()).toEqual([1, 2, 3]);
    }).pipe(Effect.scoped) as any),
  );

  it.live("refill.onDrained re-polls the source on each drain until empty", () =>
    (Effect.gen(function* () {
      const source = yield* Ref.make<Array<number>>([2, 3]); // refilled one-per-drain
      const processed = yield* Ref.make<Array<number>>([]);
      const queue = yield* WorkPool.make({
        name: "refill-drain",
        effect: (n: number) => Ref.update(processed, (a) => [...a, n]),
        refill: {
          onDrained: true,
          load: (q) =>
            Effect.gen(function* () {
              const remaining = yield* Ref.get(source);
              if (remaining.length === 0) return;
              const [head, ...tail] = remaining;
              yield* Ref.set(source, tail);
              yield* q.add([head]);
            }),
        },
        concurrency: 1,
      });
      yield* queue.add([1]); // prime; each drain pulls the next from `source`
      yield* waitUntil(Effect.map(Ref.get(processed), (p) => p.length >= 3));
      expect(yield* Ref.get(processed)).toEqual([1, 2, 3]);
    }).pipe(Effect.scoped) as any),
  );
});
