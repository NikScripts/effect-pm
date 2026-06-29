import { Effect, Schema } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import { makeResourceAtoms } from "../examples/resource-atoms/resource-atoms";

// A resource with one query (read atom), one void mutate, one payload mutate.
class Counter extends Resource.Tag<Counter>()("ratoms/Counter", {
  current: Resource.query(Schema.Number), // no-payload query → READ atom
  reset: Resource.mutate(Schema.Void), // void mutate → command fn
  increment: Resource.mutate(Schema.Void, { payload: { by: Schema.Number } }), // payload → fn
}) {}

it("derives read + command atoms from a Resource spec, and they react", () => {
  let value = 0;
  const layer = Resource.layer(Counter, {
    current: Effect.sync(() => value),
    reset: Effect.sync(() => {
      value = 0;
    }),
    increment: ({ by }) =>
      Effect.sync(() => {
        value += by;
      }),
  });

  const runtime = Atom.runtime(layer);
  // Everything derives from the tag: types from its service, spec + key from it.
  const atoms = makeResourceAtoms(runtime, Counter);

  // ── type-level: the spec classified each method correctly ──
  const _current: Atom.Atom<AsyncResult.AsyncResult<number, never>> = atoms.current;
  const _reset: Atom.AtomResultFn<void, void, never> = atoms.reset;
  const _increment: Atom.AtomResultFn<{ readonly by: number }, void, never> =
    atoms.increment;
  void _current;
  void _reset;
  void _increment;

  // ── runtime: a command refreshes the read atom (event-driven, no polling) ──
  const registry = AtomRegistry.make();
  registry.mount(atoms.current);
  const read = (): number | undefined => {
    const result = registry.get(atoms.current);
    return AsyncResult.isSuccess(result) ? result.value : undefined;
  };

  return Effect.runPromise(
    Effect.gen(function* () {
      expect(read()).toBe(0);
      registry.set(atoms.increment, { by: 5 });
      yield* Effect.sleep("80 millis");
      expect(read()).toBe(5);
      registry.set(atoms.increment, { by: 3 });
      yield* Effect.sleep("80 millis");
      expect(read()).toBe(8);
      registry.set(atoms.reset, undefined);
      yield* Effect.sleep("80 millis");
      expect(read()).toBe(0);
    }),
  );
});
