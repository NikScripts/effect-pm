import { Duration, Effect, Schema, Stream, SubscriptionRef } from "effect";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";

class Counter extends Hyperlink.Service<Counter>()("promise-test/Counter", {
  current: Hyperlink.effect(Schema.Number),
  add: Hyperlink.effectFn(Schema.Number, Schema.Number),
  maxSize: Hyperlink.value(Schema.Number),
  count: Hyperlink.ref(Schema.Number),
  ticks: Hyperlink.stream(Schema.Number),
  admin: {
    ping: Hyperlink.effect(Schema.String),
  },
}) {}

class Fallible extends Hyperlink.Service<Fallible>()("promise-test/Fallible", {
  go: Hyperlink.effect(Schema.Number, Schema.String),
}) {}

const collectAsync = <A>(iterable: AsyncIterable<A>, take: number | undefined = undefined): Promise<Array<A>> => {
  const out: Array<A> = [];
  const iterator = iterable[Symbol.asyncIterator]();
  const step = (): Promise<Array<A>> =>
    iterator.next().then((result) => {
      if (result.done === true) return out;
      out.push(result.value);
      if (typeof take === "number" && out.length >= take) {
        if (typeof iterator.return === "function") {
          return iterator.return(undefined).then(() => out);
        }
        return Promise.resolve(out);
      }
      return step();
    });
  return step();
};

it("promise adapts effect / effectFn / value / nested / stream — LOCAL handle", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const handle = yield* Counter;
      const api = Hyperlink.promise(handle);

      expect(yield* Effect.promise(() => api.current)).toBe(7);
      expect(yield* Effect.promise(() => api.add(41))).toBe(42);
      expect(api.maxSize).toBe(100); // plain value — pass through
      expect(yield* Effect.promise(() => api.admin.ping)).toBe("pong");
      expect(yield* Effect.promise(() => api.count.get)).toBe(0);

      const seen = yield* Effect.promise(() => collectAsync(api.ticks));
      expect(seen).toEqual([1, 2, 3]);
    }).pipe(
      Effect.provide(
        Hyperlink.layer(
          Counter,
          Effect.gen(function* () {
            const cell = yield* SubscriptionRef.make(0);
            return {
              current: Effect.succeed(7),
              add: (by: number) => Effect.succeed(by + 1),
              maxSize: Effect.succeed(100),
              count: Hyperlink.subscribable(cell),
              ticks: Stream.make(1, 2, 3),
              admin: { ping: Effect.succeed("pong") },
            };
          }),
        ),
      ),
      Effect.scoped,
    ),
  ));

it("promise ref.changes is an AsyncIterable of live updates", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cell = yield* SubscriptionRef.make(0);
      yield* Effect.gen(function* () {
        const handle = yield* Counter;
        const api = Hyperlink.promise(handle);

        const collect = Effect.promise(() => collectAsync(api.count.changes, 3));
        const drive = Effect.gen(function* () {
          yield* Effect.sleep(Duration.millis(10));
          yield* SubscriptionRef.set(cell, 1);
          yield* Effect.sleep(Duration.millis(10));
          yield* SubscriptionRef.set(cell, 2);
        });
        const [seen] = yield* Effect.all([collect, drive], { concurrency: 2 });
        expect(seen).toEqual([0, 1, 2]);
      }).pipe(
        Effect.provide(
          Hyperlink.layer(Counter, {
            current: Effect.succeed(0),
            add: (by: number) => Effect.succeed(by),
            maxSize: Effect.succeed(1),
            count: Hyperlink.subscribable(cell),
            ticks: Stream.empty,
            admin: { ping: Effect.succeed("x") },
          }),
        ),
        Effect.scoped,
      );
    }),
  ));

it("promise rejects when the Effect fails", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const handle = yield* Fallible;
      const api = Hyperlink.promise(handle);
      const rejected = yield* Effect.promise(() => api.go.then(
        () => {
          throw new Error("expected reject");
        },
        (e: unknown) => e,
      ));
      expect(String(rejected)).toContain("boom");
    }).pipe(
      Effect.provide(Hyperlink.layer(Fallible, { go: Effect.fail("boom") })),
      Effect.scoped,
    ),
  ));
