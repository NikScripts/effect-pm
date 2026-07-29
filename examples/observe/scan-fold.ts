/**
 * @module examples/observe/scan-fold
 *
 * `Observe.scan` keeps capped history from a live source; `Observe.fold` keeps an
 * arbitrary accumulator over the same style of source.
 *
 * ```bash
 * pnpm run example:observe-scan-fold
 * ```
 */

// ---cut---
import { Effect, Schema, SubscriptionRef } from "effect";
import { Atom, AtomRegistry, AsyncResult } from "effect/unstable/reactivity";
import * as Hyperlink from "../../src/Hyperlink";
import * as Observe from "../../src/Observe";

class Counter extends Hyperlink.Tag<Counter>()("examples/ObserveScanFold/Counter", {
  count: Hyperlink.ref(Schema.Number),
  add: Hyperlink.effectFn({ by: Schema.Number }, Schema.Number),
}) {}

const CounterLive = Hyperlink.layer(
  Counter,
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(0);
    return {
      count: Hyperlink.subscribable(count),
      add: ({ by }: { readonly by: number }) =>
        SubscriptionRef.update(count, (n) => n + by).pipe(
          Effect.andThen(SubscriptionRef.get(count)),
        ),
    };
  }),
);

const pack = Observe.named(
  "examples/observe/scan-fold",
  Observe.struct({
    add: Observe.fn((counter: Counter["Service"]) => counter.add),
    history: Observe.scan((counter: Counter["Service"]) => counter.count, {
      map: (n) => n,
      cap: 4,
      seed: (counter) => Effect.map(counter.count.get, (n) => [n]),
    }),
    total: Observe.fold((counter: Counter["Service"]) => counter.count, {
      initial: () => 0,
      step: (sum, n) => sum + n,
      seed: (counter) => Effect.map(counter.count.get, (n) => [n]),
    }),
  }),
);

const runtime = Atom.runtime(CounterLive);
const box = Observe.bind(runtime)(Counter, pack);
const registry = AtomRegistry.make();

const readSuccess = <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>): A => {
  const value = registry.get(atom);
  if (AsyncResult.isSuccess(value)) return value.value;
  throw new Error(`atom not ready: ${value._tag}`);
};

try {
  const unmountHistory = registry.mount(box.history);
  const unmountTotal = registry.mount(box.total);

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.sleep("80 millis");

      registry.set(box.add, { by: 1 });
      registry.set(box.add, { by: 2 });
      registry.set(box.add, { by: 3 });
      yield* Effect.sleep("160 millis");

      const history = readSuccess(box.history);
      const total = readSuccess(box.total);
      yield* Effect.logInfo(`history=${history.join(" -> ")} total=${String(total)}`);

      if (history.join(",") !== "0,1,3,6" || total !== 10) {
        return yield* Effect.die(
          new Error(`unexpected scan/fold: ${JSON.stringify({ history, total })}`),
        );
      }
    }).pipe(Effect.tap(() => Effect.logInfo("example:observe-scan-fold finished OK"))),
  );

  unmountTotal();
  unmountHistory();
} finally {
  registry.dispose();
}
