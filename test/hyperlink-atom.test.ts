/**
 * Hyperlink.atom / query / fn — Effect-reactive adapters over a Tag.
 */
import { Effect, Layer, Schema, Stream, SubscriptionRef } from "effect";
import { Atom, AtomRegistry, AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import { channelKeyOf } from "../src/internal/atomHandle";

class Counter extends Hyperlink.Service<Counter>()("atom-test/Counter", {
  count: Hyperlink.ref(Schema.Number),
  ticks: Hyperlink.stream(Schema.Number),
  current: Hyperlink.effect(Schema.Number),
  add: Hyperlink.effectFn(Schema.Number, Schema.Number),
  bump: Hyperlink.effect(Schema.Void),
}) {}

/** Fresh layer per test — Atom.runtime memoizes layers across the process. */
const makeCounterLayer = () =>
  Hyperlink.layer(
    Counter,
    Effect.gen(function* () {
      const cell = yield* SubscriptionRef.make(0);
      return {
        count: Hyperlink.subscribable(cell),
        ticks: Stream.make(1, 2, 3),
        current: SubscriptionRef.get(cell),
        add: (by: number) =>
          SubscriptionRef.update(cell, (n) => n + by).pipe(Effect.as(by + 1)),
        bump: SubscriptionRef.update(cell, (n) => n + 1),
      };
    }),
  );

describe("channelKeyOf", () => {
  it("shares status and status.changes", () => {
    const a = channelKeyOf("Jobs", (q: { status: { changes: unknown } }) => q.status);
    const b = channelKeyOf("Jobs", (q: { status: { changes: unknown } }) => q.status.changes);
    expect(a).toBe("Jobs:status");
    expect(b).toBe("Jobs:status");
  });

  it("keeps nested stream paths", () => {
    expect(
      channelKeyOf("Jobs", (q: { metrics: { stream: unknown } }) => q.metrics.stream),
    ).toBe("Jobs:metrics.stream");
  });
});

describe("Hyperlink.atom / query / fn", () => {
  it("atom + fn drive a live ref", () => {
    const rt = Atom.runtime(makeCounterLayer());
    const countAtom = Hyperlink.atom(rt)(Counter, (c) => c.count);
    const bump = Hyperlink.fn(rt)(Counter, (c) => c.bump);
    expect(Hyperlink.atom(rt)(Counter, (c) => c.count.changes)).toBe(countAtom);
    expect(Hyperlink.fn(rt)(Counter, (c) => c.bump)).toBe(bump);

    const registry = AtomRegistry.make();
    registry.mount(countAtom);
    const read = (): number | undefined => {
      const result = registry.get(countAtom);
      return AsyncResult.isSuccess(result) ? result.value : undefined;
    };

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.sleep("50 millis");
        expect(read()).toBe(0);
        registry.set(bump, undefined as void);
        yield* Effect.sleep("80 millis");
        expect(read()).toBe(1);
      }),
    );
  });

  it("query memoizes one-shot reads", () => {
    const rt = Atom.runtime(makeCounterLayer());
    const currentAtom = Hyperlink.query(rt)(Counter, (c) => c.current);
    expect(Hyperlink.query(rt)(Counter, (c) => c.current)).toBe(currentAtom);

    const registry = AtomRegistry.make();
    registry.mount(currentAtom);
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.sleep("50 millis");
        const result = registry.get(currentAtom);
        expect(AsyncResult.isSuccess(result) ? result.value : undefined).toBe(0);
      }),
    );
  });

  it("atom form B caches by source object", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const handle = yield* Counter;
        const rt = Atom.runtime(Layer.empty);
        const a = Hyperlink.atom(rt)(handle.count);
        const b = Hyperlink.atom(rt)(handle.count);
        expect(a).toBe(b);
        const ticks = Hyperlink.atom(rt)(handle.ticks);
        expect(ticks).not.toBe(a);
      }).pipe(Effect.provide(makeCounterLayer()), Effect.scoped),
    ));

  it("fn with payload select", () => {
    const rt = Atom.runtime(makeCounterLayer());
    const add = Hyperlink.fn(rt)(Counter, (c) => c.add);
    expect(Hyperlink.fn(rt)(Counter, (c) => c.add)).toBe(add);
    const registry = AtomRegistry.make();
    const countAtom = Hyperlink.atom(rt)(Counter, (c) => c.count);
    registry.mount(countAtom);
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.sleep("50 millis");
        registry.set(add, 4);
        yield* Effect.sleep("80 millis");
        const result = registry.get(countAtom);
        expect(AsyncResult.isSuccess(result) ? result.value : undefined).toBe(4);
      }),
    );
  });
});
