import { it, describe, expect } from "@effect/vitest";
import { Effect, Ref } from "effect";
import { RunResource } from "../src/RunResource";

const trackedWork = (active: Ref.Ref<number>, peak: Ref.Ref<number>) =>
  Effect.gen(function* () {
    const n = yield* Ref.updateAndGet(active, (x) => x + 1);
    const p = yield* Ref.get(peak);
    if (n > p) yield* Ref.set(peak, n);
    yield* Effect.yieldNow;
    yield* Ref.update(active, (x) => x - 1);
  });

describe("RunResource.makeRunner", () => {
  it.live("concurrency 1 enforces serial execution", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0);
      const peak = yield* Ref.make(0);
      const work = trackedWork(active, peak);
      const gate = yield* RunResource.make({
        name: "@test/serial-runner",
        effect: (_: void) => work,
        concurrency: 1,
      });
      yield* Effect.all(Array.from({ length: 30 }, () => gate(undefined)), {
        concurrency: "unbounded",
      });
      const p = yield* Ref.get(peak);
      expect(p).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.live("respects concurrency limit", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0);
      const peak = yield* Ref.make(0);
      const work = trackedWork(active, peak);
      const gate = yield* RunResource.make({
        name: "@test/concurrency-4-runner",
        effect: (_: void) => work,
        concurrency: 4,
      });
      yield* Effect.all(Array.from({ length: 40 }, () => gate(undefined)), {
        concurrency: "unbounded",
      });
      const p = yield* Ref.get(peak);
      expect(p).toBeLessThanOrEqual(4);
      expect(p).toBeGreaterThan(1);
    }).pipe(Effect.scoped),
  );
});

describe("RunResource.Service (parameterized gate)", () => {
  it.live("gates a function effect with concurrency", () =>
    Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: "@test/Multiply",
        effect: (n: number) => Effect.succeed(n * 2),
        concurrency: 2,
      });
      const results = yield* Effect.all(
        [gate(5), gate(10), gate(15)],
        { concurrency: "unbounded" },
      );
      expect(results).toEqual([10, 20, 30]);
    }).pipe(Effect.scoped),
  );

  it.live("limits concurrency on parameterized gate", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0);
      const peak = yield* Ref.make(0);
      const gate = yield* RunResource.make({
        name: "@test/SlowGate",
        effect: (s: string) =>
          Effect.gen(function* () {
            const n = yield* Ref.updateAndGet(active, (x) => x + 1);
            const p = yield* Ref.get(peak);
            if (n > p) yield* Ref.set(peak, n);
            yield* Effect.yieldNow;
            yield* Ref.update(active, (x) => x - 1);
            return s.toUpperCase();
          }),
        concurrency: 2,
      });
      yield* Effect.all(
        Array.from({ length: 20 }, (_, i) => gate(`item-${String(i)}`)),
        { concurrency: "unbounded" },
      );
      const p = yield* Ref.get(peak);
      expect(p).toBeLessThanOrEqual(2);
    }).pipe(Effect.scoped),
  );
});

describe("RunResource.Tag + layer", () => {
  it.live("Tag produces valid service key", () =>
    Effect.gen(function* () {
      const tag = RunResource.Tag<
        { readonly _tag: "TestGate" },
        number,
        number,
        never
      >()("@test/TestGate");
      expect(tag.key).toBe("@test/TestGate");
    }),
  );

  it.live("make produces a working gate directly", () =>
    Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: "@test/DirectGate",
        effect: (n: number) => Effect.succeed(n + 100),
        concurrency: 1,
      });
      const result = yield* gate(5);
      expect(result).toBe(105);
    }).pipe(Effect.scoped),
  );
});

describe("RunResource.make (raw scoped)", () => {
  it.live("produces a working gate without tags", () =>
    Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: "@test/raw",
        effect: (n: number) => Effect.succeed(n * 3),
        concurrency: 2,
      });
      const result = yield* gate(7);
      expect(result).toBe(21);
    }).pipe(Effect.scoped),
  );
});
