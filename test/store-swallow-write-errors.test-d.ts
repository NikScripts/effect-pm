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
  }),
);

const base = Store.effects("s", contract);
const guarded = Store.swallowWriteErrors(base);

// `swallowWriteErrors` is type-preserving: same `StoreEffectsOf<C>` in and out.
type Base = typeof base;
type Guarded = typeof guarded;
type MutuallyAssignable = [Base] extends [Guarded]
  ? [Guarded] extends [Base]
    ? true
    : false
  : false;
true satisfies MutuallyAssignable;

// It composes with `pipe`, yielding the same type.
const piped = pipe(Store.effects("s", contract), Store.swallowWriteErrors);
type Piped = typeof piped;
type PipedSame = [Piped] extends [Base] ? ([Base] extends [Piped] ? true : false) : false;
true satisfies PipedSame;

// A write method keeps its public signature (`Effect<void, never, Storage>`).
void ({} as Guarded["sensors"]["temperature"]["append"] satisfies (
  row:
    | { readonly celsius: number }
    | ReadonlyArray<{ readonly celsius: number }>,
) => Effect.Effect<void, never, Store.Storage>);

// A custom append method likewise stays `Effect<void, never, Storage>`.
void ({} as Guarded["record"] satisfies (
  row: { readonly id: string } | ReadonlyArray<{ readonly id: string }>,
) => Effect.Effect<void, never, Store.Storage>);
