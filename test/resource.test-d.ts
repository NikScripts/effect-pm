import { Effect, Schema } from "effect";
import type { ServiceOf, Spec } from "../src/Resource";

// One spec, every entry form.
const _spec = {
  current: Schema.Number, // bare schema → property, success = number
  reset: Schema.Void, // bare schema → property, success = void
  add: { payload: { id: Schema.String }, error: Schema.String }, // descriptor → method, error channel
} satisfies Spec;

type S = ServiceOf<typeof _spec>;
declare const s: S;

// bare schema → property `Effect<Success, never>`
const _current: Effect.Effect<number, never> = s.current;
void _current;
const _reset: Effect.Effect<void, never> = s.reset;
void _reset;

// descriptor with payload → method `(payload) => Effect<Success, Error>`
// (success omitted → void; error schema → the error channel)
const _add: Effect.Effect<void, string> = s.add({ id: "x" });
void _add;

// @ts-expect-error a no-payload method is a property, not callable
void s.current();
