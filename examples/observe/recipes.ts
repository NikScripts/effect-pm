/**
 * @module examples/observe/recipes
 *
 * Non-React Observe primitives: `atom`, `query`, `fn`, and `poll` become atoms
 * only when bound with `Observe.bind(runtime)(Tag, pack)`.
 *
 * ```bash
 * pnpm run example:observe-recipes
 * ```
 */

// ---cut---
import { Effect, Schema, SubscriptionRef } from "effect";
import { Atom, AtomRegistry, AsyncResult } from "effect/unstable/reactivity";
import * as Hyperlink from "../../src/Hyperlink";
import * as Observe from "../../src/Observe";

class Counter extends Hyperlink.Service<Counter>()("examples/ObserveRecipes/Counter", {
  count: Hyperlink.ref(Schema.Number),
  current: Hyperlink.effect(Schema.Number),
  add: Hyperlink.effectFn({ by: Schema.Number }, Schema.Number),
}) {}

const CounterLive = Hyperlink.layer(
  Counter,
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);
    return {
      count: Hyperlink.subscribable(count),
      current: SubscriptionRef.get(count),
      add: ({ by }: { readonly by: number }) =>
        SubscriptionRef.update(count, (n) => n + by).pipe(
          Effect.andThen(SubscriptionRef.get(count)),
        ),
    };
  }),
);

const counterPack = Observe.named(
  "examples/observe/recipes",
  Observe.struct({
    live: Observe.atom((counter: Counter["Service"]) => counter.count),
    current: Observe.query((counter: Counter["Service"]) => counter.current),
    add: Observe.fn((counter: Counter["Service"]) => counter.add),
    polled: Observe.poll((counter: Counter["Service"]) => counter.current, "50 millis"),
  }),
);

const runtime = Atom.runtime(CounterLive);
const box = Observe.bind(runtime)(Counter, counterPack);
const registry = AtomRegistry.make();

const readSuccess = <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>): A => {
  const value = registry.get(atom);
  if (AsyncResult.isSuccess(value)) return value.value;
  throw new Error(`atom not ready: ${value._tag}`);
};

try {
  const unmountLive = registry.mount(box.live);
  const unmountCurrent = registry.mount(box.current);
  const unmountPolled = registry.mount(box.polled);

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.sleep("80 millis");
      yield* Effect.logInfo(`initial atom=${String(readSuccess(box.live))}`);

      registry.set(box.add, { by: 3 });
      yield* Effect.sleep("120 millis");
      registry.refresh(box.current);
      yield* Effect.sleep("80 millis");

      const live = readSuccess(box.live);
      const current = readSuccess(box.current);
      const polled = readSuccess(box.polled);
      yield* Effect.logInfo(
        `after add: atom=${String(live)} query=${String(current)} poll=${String(polled)}`,
      );

      if (live !== 3 || current !== 3 || polled !== 3) {
        return yield* Effect.die(
          new Error(`unexpected values: ${JSON.stringify({ live, current, polled })}`),
        );
      }
    }).pipe(Effect.tap(() => Effect.logInfo("example:observe-recipes finished OK"))),
  );

  unmountPolled();
  unmountCurrent();
  unmountLive();
} finally {
  registry.dispose();
}
