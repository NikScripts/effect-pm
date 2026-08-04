import { Effect, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as Hyperlink from "../src/Hyperlink";

// Proof that interface-driven tags are a **call-signature overload** on `Tag` itself
// (`Tag<Self, I>()`), not a second factory. Schema path is `Tag<Self>()` — same value.

interface CounterShape {
  readonly current: Effect.Effect<number>; // local effect
  readonly add: (by: number) => Effect.Effect<number>; // wired
  readonly label: string; // local raw value
}
class Counter extends Hyperlink.Service<Counter, CounterShape>()("tag-iface-d/Counter", {
  current: Hyperlink.local,
  add: Hyperlink.effectFn(Schema.Number, Schema.Number),
  label: Hyperlink.local,
}) {}

// The merged service — what `yield* Counter` gives.
type Svc = Hyperlink.ShapeOf<Hyperlink.SpecOf<typeof Counter>, Counter>;

// A local effect keeps its shape and GAINS `Local<CounterShape>` in its requirements — the gate. A
// client layer can't satisfy `Local`, so calling it on a client is a compile error; the local can.
expectTypeOf<Svc["current"]>().toEqualTypeOf<
  Effect.Effect<number, never, Hyperlink.Local<Counter>>
>();

// A raw-value local is obtained via `Effect<T, never, Local<CounterShape>>`.
expectTypeOf<Svc["label"]>().toEqualTypeOf<
  Effect.Effect<string, never, Hyperlink.Local<Counter>>
>();

// A wired member is a normal client method — no `Local` requirement.
expectTypeOf<Svc["add"]>().parameter(0).toEqualTypeOf<number>();

// Locals stay OFF the wire — the serve/client surface (`Wire`) has the wired member only.
expectTypeOf<
  keyof Hyperlink.Wire<Hyperlink.SpecOf<typeof Counter>>
>().toEqualTypeOf<"add">();

// ── reject: a bare local with no matching interface member is a compile error at the call ──
export class _Bad extends Hyperlink.Service<_Bad, CounterShape>()("tag-iface-d/Bad", {
  current: Hyperlink.local,
  add: Hyperlink.effectFn(Schema.Number, Schema.Number),
  // @ts-expect-error `bogus` is not a member of CounterShape — bare local has no type to resolve.
  bogus: Hyperlink.local,
}) {}

// ── reject: a wired member whose success schema disagrees with the interface ──
export class _BadWire extends Hyperlink.Service<_BadWire, CounterShape>()("tag-iface-d/BadWire", {
  current: Hyperlink.local,
  // @ts-expect-error CounterShape.add returns Effect<number>, but the success schema is String.
  add: Hyperlink.effectFn(Schema.Number, Schema.String),
  label: Hyperlink.local,
}) {}

// ── reject: bare local on plain Tag<Self>() (needs Tag<Self, I>()) ──
export class _BareOnPlain extends Hyperlink.Service<_BareOnPlain>()("tag-iface-d/BareOnPlain", {
  // @ts-expect-error bare local requires Tag<Self, I>()
  current: Hyperlink.local,
}) {}
