/**
 * @module examples/hyperlink/counter-layer
 *
 * Custom Hyperlink service with Lifecycle participation: one SubscriptionRef for
 * the counter, badge via {@link Lifecycle.stateRef}, domain `reset` kept separate
 * from stop. Provided with {@link Hyperlink.layer} (never a `*Live` alias).
 *
 * ```bash
 * pnpm run example:hyperlink-counter-layer
 * ```
 */

// ---cut---
import { Effect, Schema, SubscriptionRef } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Lifecycle from "../../src/Lifecycle";

class Counter extends Hyperlink.Service<Counter>()("examples/CounterLayer/Counter", {
  lifecycle: Lifecycle.stateRef,
  lifecycleEvents: Lifecycle.eventStream,
  start: Hyperlink.effect(Schema.Void).pipe(Lifecycle.asStart),
  stop: Hyperlink.effect(Schema.Void).pipe(Lifecycle.asStop),
  value: Hyperlink.ref(Schema.Number),
  current: Hyperlink.effect(Schema.Number),
  increment: Hyperlink.effectFn({ by: Schema.Number }, Schema.Number),
  reset: Hyperlink.effect(Schema.Void),
}) {}

const layer = Hyperlink.layer(
  Counter,
  Effect.gen(function* () {
    const value = yield* SubscriptionRef.make(0);
    const lc = yield* Lifecycle.make({
      run: Effect.never,
      afterStop: Lifecycle.idle,
    });
    return {
      ...Lifecycle.impl(lc),
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
  yield* Lifecycle.start(Counter);
  const one = yield* counter.increment({ by: 1 });
  const two = yield* counter.increment({ by: 1 });
  yield* Effect.logInfo(`counter values: ${String(one)} -> ${String(two)}`);

  yield* counter.reset;
  const afterReset = yield* counter.current;
  if (afterReset !== 0) {
    return yield* Effect.die(
      new Error(`expected 0 after reset, got ${String(afterReset)}`),
    );
  }

  yield* Lifecycle.stop(Counter);
  yield* Effect.logInfo(
    `lifecycle after stop: ${(yield* counter.lifecycle.get)._tag}`,
  );
}).pipe(Effect.provide(layer), Effect.scoped);

// ---cut-after---
await Effect.runPromise(
  program.pipe(
    Effect.tap(() => Effect.logInfo("example:hyperlink-counter-layer finished OK")),
  ),
);
