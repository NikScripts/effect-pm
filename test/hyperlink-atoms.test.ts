import { Effect, Schema } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import { makeHyperlinkAtoms } from "../examples/hyperlink-atoms/hyperlink-atoms";

// A resource with one query (read atom), one void command, one payload mutate.
class Counter extends Hyperlink.Tag<Counter>()("ratoms/Counter", {
  current: Hyperlink.effect(Schema.Number), // value read → READ atom
  reset: Hyperlink.effect(Schema.Void), // void command → action fn
  increment: Hyperlink.effectFn({ by: Schema.Number }), // payload → fn
}) {}

it("derives read + command atoms from a Hyperlink spec, and they react", () => {
  let value = 0;
  const layer = Hyperlink.layer(Counter, {
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
  const atoms = makeHyperlinkAtoms(runtime, Counter);

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
