import { Effect, Schema, Scope, Stream } from "effect";
import * as Store from "../src/Store";
import type { ShapeHandles, ShapeRef, ShapeRefs } from "../src/internal/store/contract";
import { StoreJournalDecodeError, StoreScopeNotRegistered } from "../src/internal/store/errors";

// ============================================================================
// Fixtures — a nested shape tree (`sensors.temperature`, `sensors.humidity`) plus a flat leaf.
// ============================================================================

const temperatureRow = Schema.Struct({ celsius: Schema.Number });
const humidityRow = Schema.Struct({ percent: Schema.Number });
const alertRow = Schema.Struct({ message: Schema.String });

const nestedContract = Store.contract(
  {
    sensors: {
      temperature: temperatureRow,
      humidity: humidityRow,
    },
    alerts: alertRow,
  },
  ({ sensors, alerts }) => ({
    // Part 2 custom methods alias the DEFAULT effects reached through the nested tree — this only
    // compiles if `ShapeHandles` recurses (`sensors.temperature.append` navigates a sub-tree).
    recordTemp: sensors.temperature.append,
    latestTemp: sensors.temperature.read,
    recordAlert: alerts.append,
  }),
);

type Shapes = (typeof nestedContract)["shapes"];

// ============================================================================
// 1. Nested handle access — the methods-fn handle tree is recursive.
// ============================================================================

declare const _handles: ShapeHandles<Shapes>;
void _handles.sensors.temperature.append({ celsius: 21 });
void _handles.sensors.temperature.read();
void _handles.sensors.humidity.append({ percent: 40 });
void _handles.alerts.append({ message: "hot" });

// The selectable ref tree mirrors the same nesting; a leaf carries its row schema.
declare const _refs: ShapeRefs<Shapes>;
type SelectedTemperatureRef = typeof _refs.sensors.temperature;
void ({} as SelectedTemperatureRef satisfies ShapeRef<typeof temperatureRow>);

// ============================================================================
// 2. Resolved handle — `yield* Store` / `Store.at` / `tag.store` — is nested for real.
// ============================================================================

// The value you get from `yield* SensorStore` / `Store.at(...)` / `tag.store` — the resolved handle.
type ResolvedHandle = Store.HandleOf<typeof nestedContract>;
declare const _handle: ResolvedHandle;

// Nested append/read resolve to the RIGHT signatures on the resolved handle — NOT `never`.
type TempAppend = ResolvedHandle["sensors"]["temperature"]["append"];
type TempRead = ResolvedHandle["sensors"]["temperature"]["read"];
void ({} as TempAppend satisfies (
  row:
    | { readonly celsius: number }
    | ReadonlyArray<{ readonly celsius: number }>,
) => Effect.Effect<void, Store.StoreWriteError>);
void ({} as TempRead satisfies () => Effect.Effect<ReadonlyArray<{ readonly celsius: number }>>);
void _handle.sensors.temperature.append({ celsius: 21 });
void _handle.sensors.temperature.read();
void _handle.sensors.humidity.append({ percent: 40 });
// A flat leaf still sits at the top level of the same handle.
void _handle.alerts.append({ message: "hot" });
// The nested leaf members are NOT `never` (a `never` leaf would make these checks fail).
true satisfies [TempAppend] extends [never] ? false : true;
true satisfies [TempRead] extends [never] ? false : true;

// A FLAT contract's resolved handle is unchanged (top-level `readings.append`/`.read`).
const flatContract = Store.contract({
  readings: Schema.Struct({ value: Schema.Number }),
});
type FlatHandle = Store.HandleOf<typeof flatContract>;
declare const _flat: FlatHandle;
void _flat.readings.append({ value: 1 });
void _flat.readings.read();
void ({} as FlatHandle["readings"]["append"] satisfies (
  row: { readonly value: number } | ReadonlyArray<{ readonly value: number }>,
) => Effect.Effect<void, Store.StoreWriteError>);

// ============================================================================
// Effect / Stream extractors.
// ============================================================================

type SuccessOf<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never;
type ErrorOf<T> = T extends Effect.Effect<infer _A, infer E, infer _R> ? E : never;
type ContextOf<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;
type StreamRowOf<S> = S extends Stream.Stream<infer A, infer _E, infer _R> ? A : never;
type StreamErrorOf<S> = S extends Stream.Stream<infer _A, infer E, infer _R> ? E : never;

const SensorStore = Store.store("sensor-scope", nestedContract);

// ============================================================================
// 3a. Coarse form — `changes(scope)` stays the untouched firehose.
// ============================================================================

const coarse = Store.changes("sensor-scope");
type CoarseStream = SuccessOf<typeof coarse>;
void ({} as StreamRowOf<CoarseStream> satisfies Store.StoreChangeEvent);
void ({} as Store.StoreChangeEvent satisfies StreamRowOf<CoarseStream>);
void ({} as StreamErrorOf<CoarseStream> satisfies StoreJournalDecodeError);
void ({} as ErrorOf<typeof coarse> satisfies StoreScopeNotRegistered);
void ({} as StoreScopeNotRegistered satisfies ErrorOf<typeof coarse>);
void ({} as ContextOf<typeof coarse> satisfies Store.Storage | Scope.Scope);

// ============================================================================
// 3b. Typed-all form — `changes(store)` → discriminated union of every shape's rows.
// ============================================================================

const allRows = Store.changes(SensorStore);
type AllRowsStream = SuccessOf<typeof allRows>;
type AllRow = StreamRowOf<AllRowsStream>;
// Every leaf row (nested + flat) appears in the union, and nothing else.
void ({} as { readonly celsius: number } satisfies AllRow);
void ({} as { readonly percent: number } satisfies AllRow);
void ({} as { readonly message: string } satisfies AllRow);
void ({} as AllRow satisfies
  | { readonly celsius: number }
  | { readonly percent: number }
  | { readonly message: string });
void ({} as StreamErrorOf<AllRowsStream> satisfies StoreJournalDecodeError);
// The typed forms erase the scope-not-registered failure (a store class always registers its scope).
void ({} as ErrorOf<typeof allRows> satisfies never);
void ({} as ContextOf<typeof allRows> satisfies Store.Storage | Scope.Scope);

// ============================================================================
// 3c. Shape-selected form — the selector navigates the tree; result is THAT shape's rows.
// ============================================================================

const tempChanges = Store.changes(SensorStore, (s) => s.sensors.temperature);
type TempStream = SuccessOf<typeof tempChanges>;
type TempRow = StreamRowOf<TempStream>;
// The DESIRED type: exactly `TemperatureRow`, decoded — not the coarse `StoreChangeEvent`.
void ({} as TempRow satisfies { readonly celsius: number });
void ({} as { readonly celsius: number } satisfies TempRow);
void ({} as StreamErrorOf<TempStream> satisfies StoreJournalDecodeError);
void ({} as ErrorOf<typeof tempChanges> satisfies never);
void ({} as ContextOf<typeof tempChanges> satisfies Store.Storage | Scope.Scope);

// Selecting a different leaf infers its own row (proves selector-driven inference, not a fixed row).
const humidityChanges = Store.changes(SensorStore, (s) => s.sensors.humidity);
type HumidityRow = StreamRowOf<SuccessOf<typeof humidityChanges>>;
void ({} as HumidityRow satisfies { readonly percent: number });
void ({} as { readonly percent: number } satisfies HumidityRow);

// A flat (non-nested) leaf selects too.
const alertChanges = Store.changes(SensorStore, (s) => s.alerts);
type AlertRow = StreamRowOf<SuccessOf<typeof alertChanges>>;
void ({} as AlertRow satisfies { readonly message: string });
void ({} as { readonly message: string } satisfies AlertRow);
