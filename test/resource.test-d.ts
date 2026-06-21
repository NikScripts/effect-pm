import { Effect, Layer, Schema } from "effect";
import { Resource } from "../src/Resource";
import type { ServiceOf, Spec } from "../src/Resource";

// ── Slice 1: spec → service-interface inference ──
const _spec = {
  current: Schema.Number, // bare schema → property, success = number
  reset: Schema.Void, // bare schema → property, success = void
  add: { payload: { id: Schema.String }, error: Schema.String }, // descriptor → method, error channel
} satisfies Spec;

type S = ServiceOf<typeof _spec>;
declare const s: S;

const _current: Effect.Effect<number, never> = s.current;
void _current;
const _reset: Effect.Effect<void, never> = s.reset;
void _reset;
const _add: Effect.Effect<void, string> = s.add({ id: "x" });
void _add;

// @ts-expect-error a no-payload method is a property, not callable
void s.current();

// ── Slice 2: Tag + `yield*` + local layer ──
class Counter extends Resource.Tag<Counter>("Counter")({
  increment: { payload: { by: Schema.Number } },
  reset: Schema.Void,
  current: Schema.Number,
}) {}

// `yield* Tag` yields the inferred service; requirement is the Tag itself
const _use: Effect.Effect<number, never, Counter> = Effect.gen(function* () {
  const c = yield* Counter;
  yield* c.increment({ by: 1 });
  yield* c.reset;
  return yield* c.current;
});
void _use;

// the local layer accepts a typed implementation of the inferred service
const _layer: Layer.Layer<Counter> = Resource.layer(Counter, {
  increment: () => Effect.void,
  reset: Effect.void,
  current: Effect.succeed(0),
});
void _layer;
