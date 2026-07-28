/**
 * Hyperlink.atom / query / fn — type-level.
 */
import { Schema, Stream } from "effect";
import { Atom, AsyncResult } from "effect/unstable/reactivity";
import { expectTypeOf } from "vitest";
import * as Hyperlink from "../src/Hyperlink";

class Counter extends Hyperlink.Tag<Counter>()("atom-d/Counter", {
  count: Hyperlink.ref(Schema.Number),
  ticks: Hyperlink.stream(Schema.Number),
  current: Hyperlink.effect(Schema.Number),
  add: Hyperlink.effectFn(Schema.Number, Schema.Number),
}) {}

declare const rt: Atom.AtomRuntime<Counter>;
declare const handle: Counter["Service"];

const countAtom = Hyperlink.atom(rt)(Counter, (c) => c.count);
expectTypeOf(countAtom).toMatchTypeOf<
  Atom.Atom<AsyncResult.AsyncResult<number, unknown>>
>();

const ticksAtom = Hyperlink.atom(rt)(Counter, (c) => c.ticks);
expectTypeOf(ticksAtom).toMatchTypeOf<
  Atom.Atom<AsyncResult.AsyncResult<number, unknown>>
>();

const fromHandle = Hyperlink.atom(rt)(handle.count);
expectTypeOf(fromHandle).toMatchTypeOf<
  Atom.Atom<AsyncResult.AsyncResult<number, unknown>>
>();

const fromStream = Hyperlink.atom(rt)(Stream.empty as Stream.Stream<number>);
expectTypeOf(fromStream).toMatchTypeOf<
  Atom.Atom<AsyncResult.AsyncResult<number, unknown>>
>();

const current = Hyperlink.query(rt)(Counter, (c) => c.current);
expectTypeOf(current).toMatchTypeOf<
  Atom.Atom<AsyncResult.AsyncResult<number, unknown>>
>();

const add = Hyperlink.fn(rt)(Counter, (c) => c.add);
expectTypeOf(add).toMatchTypeOf<
  Atom.AtomResultFn<number, number, unknown>
>();
