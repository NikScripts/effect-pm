import { Effect, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as Resource from "../src/Resource";

interface CounterShape {
  readonly current: Effect.Effect<number>; // local effect
  readonly add: (by: number) => Effect.Effect<number>; // wired
  readonly label: string; // local raw value
}
class Counter extends Resource.fromService<Counter, CounterShape>()("from-svc-d/Counter", {
  current: Resource.local,
  add: Resource.effectFn(Schema.Number, Schema.Number),
  label: Resource.local,
}) {}

// The merged service — what `yield* Counter` gives.
type Svc = Resource.ShapeOf<Resource.SpecOf<typeof Counter>, Counter>;

// A local effect keeps its shape and GAINS `Local<CounterShape>` in its requirements — the gate. A
// client layer can't satisfy `Local`, so calling it on a client is a compile error; the local can.
expectTypeOf<Svc["current"]>().toEqualTypeOf<
  Effect.Effect<number, never, Resource.Local<Counter>>
>();

// A raw-value local is obtained via `Effect<T, never, Local<CounterShape>>`.
expectTypeOf<Svc["label"]>().toEqualTypeOf<
  Effect.Effect<string, never, Resource.Local<Counter>>
>();

// A wired member is a normal client method — no `Local` requirement.
expectTypeOf<Svc["add"]>().parameter(0).toEqualTypeOf<number>();

// ── reject: a bare local with no matching interface member is a compile error at the call ──
export class _Bad extends Resource.fromService<_Bad, CounterShape>()("from-svc-d/Bad", {
  current: Resource.local,
  add: Resource.effectFn(Schema.Number, Schema.Number),
  // @ts-expect-error `bogus` is not a member of CounterShape — bare local has no type to resolve.
  bogus: Resource.local,
}) {}
