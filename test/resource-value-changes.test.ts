import { Duration, Effect, Schema, Stream, SubscriptionRef } from "effect";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// `Resource.changes(svc, selector)` subscribes directly to a `value` field's live delta stream — the
// current value first, then every update — addressed by a **selector** (nesting-friendly, no string paths).
class Live extends Resource.Tag<Live>()("changes-test/Live", {
  count: Resource.value(Schema.Number),
  stats: {
    online: Resource.value(Schema.Number),
  },
  label: Resource.effect(Schema.String), // NOT a value field — selecting it must die
}) {}

it("changes(svc, s => …) streams a value's deltas — flat + nested", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const countRef = yield* SubscriptionRef.make(0);
      const onlineRef = yield* SubscriptionRef.make(10);

      yield* Effect.gen(function* () {
        const p = yield* Live;
        expect(p.count).toBe(0); // plain read still works
        expect(p.stats.online).toBe(10);

        // collect current + two deltas while a concurrent driver pushes updates
        const collect = Resource.changes(p, (s) => s.count).pipe(
          Stream.take(3),
          Stream.runCollect,
        );
        const drive = Effect.gen(function* () {
          yield* Effect.sleep(Duration.millis(10));
          yield* SubscriptionRef.set(countRef, 1);
          yield* Effect.sleep(Duration.millis(10));
          yield* SubscriptionRef.set(countRef, 2);
        });
        const [seen] = yield* Effect.all([collect, drive], { concurrency: 2 });
        expect(Array.from(seen)).toEqual([0, 1, 2]); // current replayed, then the deltas

        // nested value field — selector navigates the tree, no string path
        const online = yield* Resource.changes(p, (s) => s.stats.online).pipe(
          Stream.take(1),
          Stream.runCollect,
        );
        expect(Array.from(online)).toEqual([10]);

        // ref() exposes the SubscriptionRef itself
        expect(yield* SubscriptionRef.get(Resource.ref(p, (s) => s.count))).toBe(2);

        // selecting a non-value field dies loudly
        expect(() => Resource.changes(p, (s) => s.label)).toThrow(
          /not a live value field/,
        );
      }).pipe(
        Effect.provide(
          Resource.layer(Live, {
            count: SubscriptionRef.changes(countRef),
            stats: { online: SubscriptionRef.changes(onlineRef) },
            label: Effect.succeed("srv"),
          }),
        ),
        Effect.scoped,
      );
    }),
  ));
