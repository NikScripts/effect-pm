/**
 * @module examples/observe/hyperlink-atom
 *
 * Hyperlink atom adapters bind one field at a time: `Hyperlink.atom` for refs /
 * streams, `Hyperlink.query` for Effect reads, and `Hyperlink.fn` for commands.
 *
 * ```bash
 * pnpm run example:observe-hyperlink-atom
 * ```
 */

// ---cut---
import { Effect, Schema, SubscriptionRef } from "effect";
import { Atom, AtomRegistry, AsyncResult } from "effect/unstable/reactivity";
import * as Hyperlink from "../../src/Hyperlink";

class Counter extends Hyperlink.Service<Counter>()("examples/ObserveHyperlinkAtom/Counter", {
  count: Hyperlink.ref(Schema.Number),
  current: Hyperlink.effect(Schema.Number),
  add: Hyperlink.effectFn({ by: Schema.Number }, Schema.Number),
}) {}

const CounterLive = Hyperlink.layer(
  Counter,
  Effect.gen(function* () {
    const count = yield* SubscriptionRef.make(1);
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

const runtime = Atom.runtime(CounterLive);
const countAtom = Hyperlink.atom(runtime)(Counter, (counter) => counter.count);
const currentAtom = Hyperlink.query(runtime)(Counter, (counter) => counter.current);
const addAtom = Hyperlink.fn(runtime)(Counter, (counter) => counter.add);

const registry = AtomRegistry.make();

const readSuccess = <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>): A => {
  const value = registry.get(atom);
  if (AsyncResult.isSuccess(value)) return value.value;
  throw new Error(`atom not ready: ${value._tag}`);
};

try {
  const unmountCount = registry.mount(countAtom);
  const unmountCurrent = registry.mount(currentAtom);

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.sleep("80 millis");
      yield* Effect.logInfo(`count atom before command: ${String(readSuccess(countAtom))}`);

      registry.set(addAtom, { by: 4 });
      yield* Effect.sleep("100 millis");
      registry.refresh(currentAtom);
      yield* Effect.sleep("80 millis");

      const count = readSuccess(countAtom);
      const current = readSuccess(currentAtom);
      yield* Effect.logInfo(`count atom=${String(count)} query atom=${String(current)}`);

      if (count !== 5 || current !== 5) {
        return yield* Effect.die(
          new Error(`unexpected atoms: ${JSON.stringify({ count, current })}`),
        );
      }
    }).pipe(Effect.tap(() => Effect.logInfo("example:observe-hyperlink-atom finished OK"))),
  );

  unmountCurrent();
  unmountCount();
} finally {
  registry.dispose();
}
