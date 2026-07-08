import { Context, Effect, Stream, Schema } from "effect";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// `Resource.provideContext` (over `Resource.mapEffects`) discharges a captured context into every Effect
// method of an impl — the transform that replaces per-method `Effect.provideContext(...)` wrapping in the
// queue builder. Streams and Subscribables (ref fields) pass through by reference; a nested group recurses.

class Dep extends Context.Service<Dep, number>()(
  "@nikscripts/effect-pm/test/resource-provide-context.test/Dep",
) {}

class T extends Resource.Tag<T>()("provide-context/T", {
  // ref → Subscribable impl (stream: true) — must be left untouched
  value: Resource.ref(Schema.Number),
  // stream field → Stream impl (stream: true) — must be left untouched
  feed: Resource.stream(Schema.Number),
  // Effect method requiring `Dep` — provideContext discharges it (R-free after)
  scaled: Resource.effect(Schema.Number),
  // Effect method requiring nothing — providing a context is a harmless no-op
  plain: Resource.effect(Schema.Number),
  // nested group: a Stream `live` (untouched) + an Effect `history` (mapped)
  group: {
    live: Resource.stream(Schema.Number),
    history: Resource.effect(Schema.Array(Schema.Number)),
  },
}) {}

it("provideContext maps Effect methods and leaves Stream / Subscribable members untouched", () => {
  const valueSub: Resource.Subscribable<number> = {
    get: Effect.succeed(1),
    changes: Stream.make(1),
  };
  const feedStream = Stream.make(1, 2, 3);
  const liveStream = Stream.make(4, 5);

  const impl = {
    value: valueSub,
    feed: feedStream,
    scaled: Effect.map(Dep, (n) => n * 10), // requires Dep
    plain: Effect.succeed(7), // requires nothing
    group: {
      live: liveStream,
      history: Effect.succeed<ReadonlyArray<number>>([1, 2, 3]),
    },
  };

  const provided = Resource.provideContext(impl, T[Resource.specSym], Context.make(Dep, 5));

  // The `Dep`-requiring method now resolves with NO ambient service — the context discharged it.
  expect(Effect.runSync(provided.scaled)).toBe(50);
  // The requirement-free method is unaffected.
  expect(Effect.runSync(provided.plain)).toBe(7);
  // A nested-group Effect method is mapped too and resolves.
  expect(Effect.runSync(provided.group.history)).toEqual([1, 2, 3]);

  // Stream and Subscribable members pass through by reference — not wrapped.
  expect(provided.value).toBe(valueSub);
  expect(provided.feed).toBe(feedStream);
  expect(provided.group.live).toBe(liveStream);
});

it("mapEffects with a type-preserving transform maps every Effect method (streams untouched)", () => {
  const seen: Array<string> = [];
  const feedStream = Stream.make(1);

  const impl = {
    value: { get: Effect.succeed(1), changes: Stream.make(1) },
    feed: feedStream,
    scaled: Effect.succeed(2).pipe(Effect.tap(() => Effect.sync(() => seen.push("scaled")))),
    plain: Effect.succeed(3),
    group: {
      live: Stream.make(9),
      history: Effect.succeed<ReadonlyArray<number>>([]),
    },
  };

  const traced = Resource.mapEffects(impl, T[Resource.specSym], (effect) =>
    Effect.tap(effect, () => Effect.sync(() => seen.push("mapped"))),
  );

  Effect.runSync(traced.scaled);
  Effect.runSync(traced.plain);
  Effect.runSync(traced.group.history);
  // three Effect methods ran, each with its own "mapped" tap (plus scaled's own "scaled" tap)
  expect(seen.filter((s) => s === "mapped")).toHaveLength(3);
  // the stream member is the same reference (never wrapped)
  expect(traced.feed).toBe(feedStream);
});
