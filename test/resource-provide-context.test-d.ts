import { Context, Effect, Stream, Schema } from "effect";
import * as Resource from "../src/Resource";

// Type-level proof: `Resource.provideContext` strips the provided `R` from every Effect method — the result
// is R-free and assignable to `Resource.ImplOf` — while Stream / Subscribable members are left untouched.

class Dep extends Context.Service<Dep, number>()(
  "@nikscripts/effect-pm/test/resource-provide-context.test-d/Dep",
) {}

class T extends Resource.Tag<T>()("provide-context-d/T", {
  value: Resource.ref(Schema.Number),
  feed: Resource.stream(Schema.Number),
  scaled: Resource.effect(Schema.Number),
  add: Resource.effectFn(Schema.Void, { payload: Schema.Struct({ by: Schema.Number }) }),
  group: {
    live: Resource.stream(Schema.Number),
    history: Resource.effect(Schema.Array(Schema.Number)),
  },
}) {}

type Spec = Resource.SpecOf<typeof T>;

// The pre-provide impl: each Effect method still carries the worker requirement `Dep` (annotated with
// `WithRequirement` so the destructured params keep their contextual types from the spec).
const impl: Resource.WithRequirement<Resource.ImplOf<Spec>, Dep> = {
  value: { get: Effect.succeed(1), changes: Stream.make(1) },
  feed: Stream.make(1),
  scaled: Effect.map(Dep, (n) => n), // requires Dep
  add: ({ by }) => Effect.as(Dep, void by), // `by` typed from the spec; requires Dep
  group: {
    live: Stream.make(1),
    history: Effect.succeed<ReadonlyArray<number>>([]),
  },
};

const provided = Resource.provideContext(impl, T[Resource.specSym], Context.make(Dep, 1));

// The provided impl is R-free and satisfies `ImplOf` — the whole point (no cast at the queue call site).
provided satisfies Resource.ImplOf<Spec>;

// Each Effect method is R-free: `scaled` is a bare `Effect<number, never, never>` …
void ({} as typeof provided.scaled satisfies Effect.Effect<number, never, never>);
// … and `add` is `(payload) => Effect<void, never, never>`.
void ({} as typeof provided.add satisfies (
  payload: { readonly by: number },
) => Effect.Effect<void, never, never>);
// … and a nested-group method is R-free too.
void ({} as typeof provided.group.history satisfies Effect.Effect<
  ReadonlyArray<number>,
  never,
  never
>);

// Stream and Subscribable members are untouched.
void ({} as typeof provided.feed satisfies Stream.Stream<number>);
void ({} as typeof provided.value satisfies Resource.Subscribable<number>);
void ({} as typeof provided.group.live satisfies Stream.Stream<number>);

// `mapEffects` with a type-preserving transform returns the same shape (Out defaults to Impl).
const traced = Resource.mapEffects(provided, T[Resource.specSym], (e) =>
  Effect.withSpan(e, "resource"),
);
type Provided = typeof provided;
type Traced = typeof traced;
type Same = [Traced] extends [Provided] ? ([Provided] extends [Traced] ? true : false) : false;
true satisfies Same;
