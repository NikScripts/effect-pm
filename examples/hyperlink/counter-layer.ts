/**
 * @module examples/hyperlink/counter-layer
 *
 * First custom Hyperlink service: declare a Counter Tag, implement it locally with
 * a SubscriptionRef, provide it with Hyperlink.layer, then consume it with `yield* Counter`.
 *
 * ```bash
 * pnpm run example:hyperlink-counter-layer
 * ```
 */

// ---cut---
import { Effect, Schema, SubscriptionRef } from "effect";
import * as Hyperlink from "../../src/Hyperlink";

class Counter extends Hyperlink.Tag<Counter>()("examples/CounterLayer/Counter", {
  value: Hyperlink.ref(Schema.Number),
  current: Hyperlink.effect(Schema.Number),
  increment: Hyperlink.effectFn({ by: Schema.Number }, Schema.Number),
  reset: Hyperlink.effect(Schema.Void),
}) {}

const CounterLive = Hyperlink.layer(
  Counter,
  Effect.gen(function* () {
    const value = yield* SubscriptionRef.make(0);
    return {
      value: Hyperlink.subscribable(value),
      current: SubscriptionRef.get(value),
      increment: ({ by }: { readonly by: number }) =>
        SubscriptionRef.update(value, (n) => n + by).pipe(
          Effect.andThen(SubscriptionRef.get(value)),
        ),
      reset: SubscriptionRef.set(value, 0),
    };
  }),
);

const program = Effect.gen(function* () {
  const counter = yield* Counter;
  const one = yield* counter.increment({ by: 1 });
  const two = yield* counter.increment({ by: 1 });
  yield* Effect.logInfo(`counter values: ${String(one)} -> ${String(two)}`);

  const current = yield* counter.current;
  if (current !== 2) {
    return yield* Effect.die(new Error(`expected 2, got ${String(current)}`));
  }
}).pipe(Effect.provide(CounterLive), Effect.scoped);

// ---cut-after---
await Effect.runPromise(
  program.pipe(Effect.tap(() => Effect.logInfo("example:hyperlink-counter-layer finished OK"))),
);
