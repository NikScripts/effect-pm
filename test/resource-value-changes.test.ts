import { Duration, Effect, Schema, Stream, SubscriptionRef } from "effect";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// A `ref` field surfaces as a `Subscribable`: `.changes` replays the current value then streams every
// update; `.get` reads the current. Works flat and nested (the spec tree).
class Live extends Resource.Tag<Live>()("ref-test/Changes", {
  count: Resource.ref(Schema.Number),
  stats: {
    online: Resource.ref(Schema.Number),
  },
}) {}

it("ref.changes streams current + deltas; ref.get is always current — flat + nested", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const countRef = yield* SubscriptionRef.make(0);
      const onlineRef = yield* SubscriptionRef.make(10);

      yield* Effect.gen(function* () {
        const p = yield* Live;
        expect(yield* p.count.get).toBe(0);
        expect(yield* p.stats.online.get).toBe(10);

        // collect current + two deltas while a concurrent driver pushes updates
        const collect = p.count.changes.pipe(Stream.take(3), Stream.runCollect);
        const drive = Effect.gen(function* () {
          yield* Effect.sleep(Duration.millis(10));
          yield* SubscriptionRef.set(countRef, 1);
          yield* Effect.sleep(Duration.millis(10));
          yield* SubscriptionRef.set(countRef, 2);
        });
        const [seen] = yield* Effect.all([collect, drive], { concurrency: 2 });
        expect(Array.from(seen)).toEqual([0, 1, 2]); // current replayed, then the deltas

        expect(yield* p.count.get).toBe(2); // get reads the source — always current

        // nested ref — navigate the spec tree directly, no selector/string path
        const online = yield* p.stats.online.changes.pipe(Stream.take(1), Stream.runCollect);
        expect(Array.from(online)).toEqual([10]);
      }).pipe(
        Effect.provide(
          Resource.layer(Live, {
            count: Resource.subscribable(countRef),
            stats: { online: Resource.subscribable(onlineRef) },
          }),
        ),
        Effect.scoped,
      );
    }),
  ));
