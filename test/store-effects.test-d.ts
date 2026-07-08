import { Effect, Schema, pipe } from "effect";
import * as Store from "../src/Store";

// A nested contract (`sensors.temperature`/`sensors.humidity`) plus a flat contract with custom methods.

const temperatureRow = Schema.Struct({ celsius: Schema.Number });
const humidityRow = Schema.Struct({ percent: Schema.Number });

const nestedContract = Store.contract({
  sensors: {
    temperature: temperatureRow,
    humidity: humidityRow,
  },
});

const flatContract = Store.contract(
  { event: Schema.Struct({ id: Schema.String }) },
  ({ event }) => ({
    record: event.append,
    events: event.read,
  }),
);

const sensorEffects = Store.effects("sensors", nestedContract);
const queueEffects = Store.effects("queue", flatContract);

// ============================================================================
// Nested leaf effects — append/read carry `Storage` in their requirement channel.
// ============================================================================

type TempAppend = typeof sensorEffects.sensors.temperature.append;
type TempRead = typeof sensorEffects.sensors.temperature.read;

void ({} as TempAppend satisfies (
  row:
    | { readonly celsius: number }
    | ReadonlyArray<{ readonly celsius: number }>,
) => Effect.Effect<void, never, Store.Storage>);

void ({} as TempRead satisfies (
  payload?: {},
) => Effect.Effect<ReadonlyArray<{ readonly celsius: number }>, never, Store.Storage>);

// The requirement is EXACTLY `Storage` (not `never`, not `Storage | Scope`).
type TempAppendCtx = ReturnType<TempAppend> extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;
void ({} as TempAppendCtx satisfies Store.Storage);
void ({} as Store.Storage satisfies TempAppendCtx);

// A sibling nested leaf also carries `Storage` and its own row.
void sensorEffects.sensors.humidity.append({ percent: 40 });
type HumidityRead = typeof sensorEffects.sensors.humidity.read;
void ({} as HumidityRead satisfies (
  payload?: {},
) => Effect.Effect<ReadonlyArray<{ readonly percent: number }>, never, Store.Storage>);

// ============================================================================
// Flat contract — default effects AND custom methods carry `Storage`.
// ============================================================================

// Default per-shape effects on the flat leaf.
void ({} as typeof queueEffects.event.append satisfies (
  row: { readonly id: string } | ReadonlyArray<{ readonly id: string }>,
) => Effect.Effect<void, never, Store.Storage>);

// Custom methods (append/read aliases) carry `Storage` too.
void ({} as typeof queueEffects.record satisfies (
  row: { readonly id: string } | ReadonlyArray<{ readonly id: string }>,
) => Effect.Effect<void, never, Store.Storage>);

void ({} as typeof queueEffects.events satisfies (
  payload?: {},
) => Effect.Effect<ReadonlyArray<{ readonly id: string }>, never, Store.Storage>);

type RecordCtx = ReturnType<typeof queueEffects.record> extends Effect.Effect<infer _A, infer _E, infer R>
  ? R
  : never;
void ({} as RecordCtx satisfies Store.Storage);
void ({} as Store.Storage satisfies RecordCtx);

// ============================================================================
// TypeId brand — swallowWriteErrors is type-preserving, composes, and rejects non-branded input.
// ============================================================================

const guarded = Store.swallowWriteErrors(sensorEffects);
type Sensor = typeof sensorEffects;
type Guarded = typeof guarded;
// Same `StoreEffectsOf` type in and out (mutually assignable).
type SamePreserved = [Sensor] extends [Guarded]
  ? [Guarded] extends [Sensor]
    ? true
    : false
  : false;
true satisfies SamePreserved;

// `pipe(...)` composes and preserves the exact type.
const piped = pipe(Store.effects("sensors", nestedContract), Store.swallowWriteErrors);
type Piped = typeof piped;
type PipedSame = [Piped] extends [Sensor] ? ([Sensor] extends [Piped] ? true : false) : false;
true satisfies PipedSame;

// A bare object is NOT a branded effects object — the constraint rejects it.
// @ts-expect-error - `{}` lacks the StoreEffects TypeId brand
Store.swallowWriteErrors({});

// `isStoreEffects` narrows an `unknown` to a branded effects object.
declare const maybe: unknown;
if (Store.isStoreEffects(maybe)) {
  const narrowed: Store.StoreEffectsOf<Store.StoreContractValue> = maybe;
  void narrowed;
}
