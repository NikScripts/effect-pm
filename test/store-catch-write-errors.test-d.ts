import { Effect, Schema, pipe } from "effect";
import * as Store from "../src/Store";

const contract = Store.contract(
  {
    sensors: {
      temperature: Schema.Struct({ celsius: Schema.Number }),
    },
    event: Schema.Struct({ id: Schema.String }),
  },
  ({ event }) => ({
    record: event.append,
    latest: event.read,
  }),
);

const base = Store.effects("s", contract);

// Raw `Store.effects` writes honestly carry `StoreWriteError`.
void ({} as typeof base.sensors.temperature.append satisfies (
  row:
    | { readonly celsius: number }
    | ReadonlyArray<{ readonly celsius: number }>,
) => Effect.Effect<void, Store.StoreWriteError, Store.Storage>);

const guarded = Store.catchWriteErrors(base);

// `catchWriteErrors` narrows `StoreWriteError` out of a nested-leaf write.
void ({} as typeof guarded.sensors.temperature.append satisfies (
  row:
    | { readonly celsius: number }
    | ReadonlyArray<{ readonly celsius: number }>,
) => Effect.Effect<void, never, Store.Storage>);

// … and out of a custom append alias.
void ({} as typeof guarded.record satisfies (
  row: { readonly id: string } | ReadonlyArray<{ readonly id: string }>,
) => Effect.Effect<void, never, Store.Storage>);

// Reads are untouched — same `Effect<Array, never, Storage>`, no `| void` pollution.
void ({} as typeof guarded.latest satisfies (
  payload?: {},
) => Effect.Effect<ReadonlyArray<{ readonly id: string }>, never, Store.Storage>);

// It composes with `pipe`, and the result is still branded (re-narrows the same way).
const piped = pipe(Store.effects("s", contract), Store.catchWriteErrors);
void ({} as typeof piped.sensors.temperature.append satisfies (
  row:
    | { readonly celsius: number }
    | ReadonlyArray<{ readonly celsius: number }>,
) => Effect.Effect<void, never, Store.Storage>);

// A bare object is NOT a branded effects object — the constraint rejects it.
// @ts-expect-error - `{}` lacks the StoreEffects TypeId brand
Store.catchWriteErrors({});

// `mapEffects` with a type-preserving transform returns the same type (Out defaults to Effects).
const traced = Store.mapEffects(base, (effect) => Effect.withSpan(effect, "store"));
type Base = typeof base;
type Traced = typeof traced;
type TracedSame = [Traced] extends [Base] ? ([Base] extends [Traced] ? true : false) : false;
true satisfies TracedSame;
