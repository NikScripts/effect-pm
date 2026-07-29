/**
 * Observe — type-level.
 */
import { Schema } from "effect";
import { Atom, AsyncResult } from "effect/unstable/reactivity";
import { expectTypeOf } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Observe from "../src/Observe";

class Counter extends Hyperlink.Tag<Counter>()("observe-d/Counter", {
  count: Hyperlink.ref(Schema.Number),
  bump: Hyperlink.effect(Schema.Void),
}) {}

declare const rt: Atom.AtomRuntime<Counter>;

const pack = Observe.struct({
  count: Observe.atom((c: Counter["Service"]) => c.count),
  bump: Observe.fn((c: Counter["Service"]) => c.bump),
});

const box = Observe.bind(rt)(Counter, pack);
expectTypeOf(box.count).toMatchTypeOf<
  Atom.Atom<AsyncResult.AsyncResult<number, unknown>>
>();
expectTypeOf(box.bump).toMatchTypeOf<
  Atom.AtomResultFn<void, void, unknown>
>();

expectTypeOf(Observe.use).toBeCallableWith(Counter, pack);
