/**
 * Observe recipes + bind — unbound packs discharged under Atom.runtime.
 */
import { Effect, Schema, Stream, SubscriptionRef } from "effect";
import { Atom, AtomRegistry, AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Observe from "../src/Observe";

class Counter extends Hyperlink.Service<Counter>()("observe-test/Counter", {
  count: Hyperlink.ref(Schema.Number),
  ticks: Hyperlink.stream(Schema.Number),
  bump: Hyperlink.effect(Schema.Void),
  add: Hyperlink.effectFn(Schema.Number, Schema.Number),
}) {}

const makeCounterLayer = () =>
  Hyperlink.layer(
    Counter,
    Effect.gen(function* () {
      const cell = yield* SubscriptionRef.make(0);
      return {
        count: Hyperlink.subscribable(cell),
        ticks: Stream.make(1, 2, 3),
        bump: SubscriptionRef.update(cell, (n) => n + 1),
        add: (by: number) =>
          SubscriptionRef.update(cell, (n) => n + by).pipe(Effect.as(by)),
      };
    }),
  );

const counterPack = Observe.named(
  "test/counter",
  Observe.struct({
    count: Observe.atom((c: Counter["Service"]) => c.count),
    bump: Observe.fn((c: Counter["Service"]) => c.bump),
    add: Observe.fn((c: Counter["Service"]) => c.add),
  }),
);

describe("Observe.bind", () => {
  it("discharges a struct pack (memoized)", () => {
    const rt = Atom.runtime(makeCounterLayer());
    const a = Observe.bind(rt)(Counter, counterPack);
    const b = Observe.bind(rt)(Counter, counterPack);
    expect(a).toBe(b);
    expect(a.count).toBe(b.count);
    expect(a.bump).toBe(b.bump);

    const registry = AtomRegistry.make();
    registry.mount(a.count);
    const read = (): number | undefined => {
      const result = registry.get(a.count);
      return AsyncResult.isSuccess(result) ? result.value : undefined;
    };

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.sleep("50 millis");
        expect(read()).toBe(0);
        registry.set(a.bump, undefined as void);
        yield* Effect.sleep("80 millis");
        expect(read()).toBe(1);
        registry.set(a.add, 3);
        yield* Effect.sleep("80 millis");
        expect(read()).toBe(4);
      }),
    );
  });

  it("map shares one fold upstream", () => {
    const fold = Observe.fold(
      (c: Counter["Service"]) => c.ticks,
      {
        initial: () => ({ n: 0, sum: 0 }),
        step: (acc, n) => ({ n, sum: acc.sum + n }),
        channel: (tag) => `${tag.key}/ticks-fold`,
      },
    );
    const pack = Observe.struct({
      last: Observe.map(fold, (a) => a.n),
      sum: Observe.map(fold, (a) => a.sum),
    });
    const rt = Atom.runtime(makeCounterLayer());
    const box = Observe.bind(rt)(Counter, pack);
    const registry = AtomRegistry.make();
    registry.mount(box.last);
    registry.mount(box.sum);
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.sleep("80 millis");
        const last = registry.get(box.last);
        const sum = registry.get(box.sum);
        expect(AsyncResult.isSuccess(last) ? last.value : undefined).toBe(3);
        expect(AsyncResult.isSuccess(sum) ? sum.value : undefined).toBe(6);
      }),
    );
  });

  it("and / merge compose packs", () => {
    const left = Observe.struct({
      count: Observe.atom((c: Counter["Service"]) => c.count),
    });
    const right = Observe.struct({
      bump: Observe.fn((c: Counter["Service"]) => c.bump),
    });
    const pack = Observe.merge(left, right);
    const rt = Atom.runtime(makeCounterLayer());
    const box = Observe.bind(rt)(Counter, pack);
    expect(box.count).toBeDefined();
    expect(box.bump).toBeDefined();
  });
});

describe("Observe.scan", () => {
  it("caps mapped history", () => {
    const pack = Observe.struct({
      history: Observe.scan((c: Counter["Service"]) => c.ticks, {
        map: (n) => n * 10,
        cap: 2,
        cacheKey: (tag) => `${tag.key}/scan-test`,
      }),
    });
    const rt = Atom.runtime(makeCounterLayer());
    const box = Observe.bind(rt)(Counter, pack);
    const registry = AtomRegistry.make();
    registry.mount(box.history);
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.sleep("80 millis");
        const result = registry.get(box.history);
        expect(AsyncResult.isSuccess(result) ? result.value : undefined).toEqual([
          20, 30,
        ]);
      }),
    );
  });
});
