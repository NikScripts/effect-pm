import { Context, Effect, Stream, Schema } from "effect";
import * as Hyperlink from "../src/Hyperlink";

// Type-level proof: `Hyperlink.provideContext` strips the provided `R` from every Effect method — the result
// is R-free and assignable to `Hyperlink.ImplOf` — while Stream / Subscribable members are left untouched.

class Dep extends Context.Service<Dep, number>()(
  "hyperlink-ts/test/hyperlink-provide-context.test-d/Dep",
) {}

class T extends Hyperlink.Tag<T>()("provide-context-d/T", {
  value: Hyperlink.ref(Schema.Number),
  feed: Hyperlink.stream(Schema.Number),
  scaled: Hyperlink.effect(Schema.Number),
  add: Hyperlink.effectFn(Schema.Struct({ by: Schema.Number })),
  group: {
    stream: Hyperlink.stream(Schema.Number),
    query: Hyperlink.effect(Schema.Array(Schema.Number)),
  },
}) {}

type Spec = Hyperlink.SpecOf<typeof T>;

// The pre-provide impl: each Effect method still carries the worker requirement `Dep` (annotated with
// `WithRequirement` so the destructured params keep their contextual types from the spec).
const impl: Hyperlink.WithRequirement<Hyperlink.ImplOf<Spec>, Dep> = {
  value: { get: Effect.succeed(1), changes: Stream.make(1) },
  feed: Stream.make(1),
  scaled: Effect.map(Dep, (n) => n), // requires Dep
  add: ({ by }) => Effect.as(Dep, void by), // `by` typed from the spec; requires Dep
  group: {
    stream: Stream.make(1),
    query: Effect.succeed<ReadonlyArray<number>>([]),
  },
};

const provided = Hyperlink.provideContext(impl, T[Hyperlink.specSym], Context.make(Dep, 1));

// The provided impl is R-free and satisfies `ImplOf` — the whole point (no cast at the queue call site).
provided satisfies Hyperlink.ImplOf<Spec>;

// Each Effect method is R-free: `scaled` is a bare `Effect<number, never, never>` …
void ({} as typeof provided.scaled satisfies Effect.Effect<number, never, never>);
// … and `add` is `(payload) => Effect<void, never, never>`.
void ({} as typeof provided.add satisfies (
  payload: { readonly by: number },
) => Effect.Effect<void, never, never>);
// … and a nested-group method is R-free too.
void ({} as typeof provided.group.query satisfies Effect.Effect<
  ReadonlyArray<number>,
  never,
  never
>);

// Stream and Subscribable members are untouched.
void ({} as typeof provided.feed satisfies Stream.Stream<number>);
void ({} as typeof provided.value satisfies Hyperlink.Subscribable<number>);
void ({} as typeof provided.group.stream satisfies Stream.Stream<number>);

// --- Soundness: `provideContext` is SUBTRACTIVE (`Exclude<R, Ctx>`), not an unconditional strip to
// `never`. A method needing a service the provided context does NOT cover keeps a residual requirement,
// so the mistake surfaces at the `ImplOf` assignment instead of crashing at runtime. ---
class Dep2 extends Context.Service<Dep2, string>()(
  "hyperlink-ts/test/hyperlink-provide-context.test-d/Dep2",
) {}

const implPartial: Hyperlink.WithRequirement<Hyperlink.ImplOf<Spec>, Dep | Dep2> = {
  value: { get: Effect.succeed(1), changes: Stream.make(1) },
  feed: Stream.make(1),
  scaled: Effect.flatMap(Dep2, () => Effect.map(Dep, (n) => n)), // needs BOTH Dep and Dep2
  add: ({ by }) => Effect.as(Dep, void by),
  group: {
    stream: Stream.make(1),
    query: Effect.succeed<ReadonlyArray<number>>([]),
  },
};

// Provide ONLY `Dep` — `Dep2` is left uncovered.
const partial = Hyperlink.provideContext(implPartial, T[Hyperlink.specSym], Context.make(Dep, 1));

// `scaled` retains the residual `Dep2` (subtractive) — NOT a false `never`. This mutual-assignability
// assertion fails to compile if `ProvidedContext` ever regresses to an unconditional `never` (a `never`
// residual is not `Dep2`), locking in the subtractive soundness on the path everything runs on.
type ScaledResidual = typeof partial.scaled extends Effect.Effect<unknown, unknown, infer R>
  ? R
  : never;
type ResidualIsExactlyDep2 = [ScaledResidual] extends [Dep2]
  ? [Dep2] extends [ScaledResidual]
    ? true
    : false
  : false;
true satisfies ResidualIsExactlyDep2;

// `mapEffects` with a type-preserving transform returns the same shape (Out defaults to Impl).
const traced = Hyperlink.mapEffects(provided, T[Hyperlink.specSym], (e) =>
  Effect.withSpan(e, "hyperlink"),
);
type Provided = typeof provided;
type Traced = typeof traced;
type Same = [Traced] extends [Provided] ? ([Provided] extends [Traced] ? true : false) : false;
true satisfies Same;
