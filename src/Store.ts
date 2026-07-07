/**
 * **Store** — scoped append/query persistence registrations backed by a shared {@link Service}.
 *
 * @remarks
 * ## Mental model
 *
 * A **contract** declares named **shapes** (row schema + optional read payload). Each shape becomes
 * `store.<shape>.append` and `store.<shape>.read` on the materialized handle. Part 2 of
 * {@link contract} may add flat aliases, bare {@link Effect}s, or effect functions — never raw
 * `readWith` helpers.
 *
 * ## Layers
 *
 * - {@link Service.layerMemory} / {@link store.layerMemory} — `EventJournal.layerMemory` (process-local).
 * - {@link Service.layer} / {@link store.layer} with `{ filename }` — SQLite via `SqlEventJournal`
 *   (`effect/unstable/eventlog`) on `@effect/sql-sqlite-node`. Omit `filename` for
 *   `EventJournal.layerMemory`.
 *
 * ## Registration
 *
 * Register scopes on an aggregate with {@link register} or `Resource.store(tag, contract)`.
 * Resolve handles with `yield* MyStore.at(Tag)` (tag-first) or `yield* tag.store` when the tag
 * carries a `.store` attachment. Standalone {@link store} yields a single-scope handle directly.
 *
 * ## Observability
 *
 * {@link changes} streams {@link StoreChangeEvent} on every successful append (operator plumbing).
 * {@link retention} caps row count per registration — oldest rows drop after each append.
 *
 * @example Shape-first contract
 * ```ts
 * import * as Store from "@nikscripts/effect-pm/Store";
 * import * as Schema from "effect/Schema";
 *
 * const thermometerContract = Store.contract({
 *   readings: Store.shape(
 *     Schema.Struct({ value: Schema.Number }),
 *     Schema.Struct({ limit: Schema.optional(Schema.Number) }),
 *   ),
 * });
 *
 * class AppStore extends Store.Service<AppStore>("@app/Store")(
 *   Store.register("thermometer", thermometerContract),
 * ) {}
 *
 * const program = Effect.gen(function* () {
 *   const handle = yield* AppStore.at("thermometer");
 *   yield* handle.readings.append({ value: 72 });
 *   const rows = yield* handle.readings.read({ limit: 10 });
 * });
 *
 * Effect.provide(program, AppStore.layerMemory);
 * ```
 *
 * @example SQLite persistence
 * ```ts
 * Effect.provide(
 *   program,
 *   AppStore.layer({ filename: ".effect-pm/data.sqlite" }),
 * );
 * ```
 *
 * @module Store
 */

import { Effect, Schema, Stream } from "effect";
import type { Scope } from "effect/Scope";
import {
  applyStoreDefaultLogLevel,
  defineStandaloneStore,
  defineStoreService,
  defineStoreTag,
  StoreScopeBridgeTag,
  storeRegsSym,
  type StandaloneStoreClass,
  type StoreServiceClass,
  type StoreTagClass,
} from "./internal/store/defineStore";
import { layerDefaultMemory } from "./internal/store/scopeBridge";
import { StoreScopeNotRegistered, StoreChangeEvent, type StoreJournalDecodeError } from "./internal/store/errors";
import {
  makeRegistration,
  type RegisteredWithContract,
  type ScopeKeyOf,
  type StoreRegistrationAny,
  type StoreScopeTag,
  withRegistrationLogLevel,
  withRegistrationRetention,
} from "./internal/store/registration";
import {
  emptyPayloadSchema,
  isStoreContractValue,
  makeStoreContractValue,
  makeStoreShape,
  mergeStoreContracts,
  type MergedCustom,
  type ShapeHandles,
  type StoreContractValue,
  type StoreMethodsFn,
  type StoreShapeDef,
  type StoreShapes,
} from "./internal/store/contract";
import {
  type StoreHandleForKey,
  type StoreHandleFromContract,
} from "./internal/store/spec";
import type { StoreLogLevel } from "./internal/store/types";

export type { StoreLayerOptions, StoreLogLevel } from "./internal/store/types";
export type { StoreHandleFromContract } from "./internal/store/spec";
export type { MergedCustom, StoreContractValue, StoreMethodsFn, StoreShapeDef, StoreShapeInput, StoreShapes } from "./internal/store/contract";

export { StoreDuplicateScopeKey, StoreScopeNotRegistered, StoreChangeEvent } from "./internal/store/errors";

/**
 * A pipeable store contract — shapes plus optional custom methods.
 *
 * @public
 */
export type Contract<C extends StoreContractValue = StoreContractValue> = C;

/**
 * Handle inferred from a store contract.
 *
 * @public
 */
export type HandleOf<C extends StoreContractValue> = StoreHandleFromContract<C>;

/** Scope keys (tuple registrations) or accessor keys (object registrations) on a store class. @public */
export type KeysOf<T> = T extends { readonly [storeRegsSym]: infer Regs }
  ? Regs extends ReadonlyArray<{ readonly scopeKey: infer K extends string }>
    ? K
    : Regs extends Record<string, { readonly scopeKey: infer K extends string }>
      ? K
      : never
  : never;

/**
 * Row shape with an optional read-query payload schema (defaults to empty struct).
 *
 * @public
 */
export function shape<Row extends Schema.Schema<unknown>>(
  row: Row,
): StoreShapeDef<Row, typeof emptyPayloadSchema>;
export function shape<
  Row extends Schema.Schema<unknown>,
  Read extends Schema.Schema<unknown>,
>(
  row: Row,
  read: Read,
): StoreShapeDef<Row, Read>;
export function shape(
  row: Schema.Schema<unknown>,
  read?: Schema.Schema<unknown>,
): StoreShapeDef {
  return makeStoreShape(row, read);
}

/**
 * Declare store shapes and optional custom methods.
 *
 * Part 1 declares row shapes (each becomes `store.<shape>.append` / `.read`).
 * Part 2 optionally adds flat aliases, bare Effects, or effect functions — not `readWith` helpers.
 *
 * @example Part 1 only
 * ```ts
 * const c = Store.contract({ readings: readingSchema });
 * ```
 *
 * @example Part 1 + part 2
 * ```ts
 * const c = Store.contract(
 *   { readings: readingSchema },
 *   ({ readings }) => ({ latest: readings.read }),
 * );
 * ```
 *
 * @public
 */
export const contract: {
  <const Shapes extends StoreShapes>(
    shapes: Shapes,
  ): StoreContractValue<Shapes>;
  <
    const Shapes extends StoreShapes,
    const Custom extends Readonly<Record<string, unknown>>,
  >(
    shapes: Shapes,
    methods: (shapes: ShapeHandles<Shapes>) => Custom,
  ): StoreContractValue<Shapes, Custom>;
} = ((shapes: StoreShapes, methods?: (handles: ShapeHandles<StoreShapes>) => Readonly<Record<string, unknown>>) =>
  methods === undefined
    ? makeStoreContractValue(shapes)
    : makeStoreContractValue(shapes, methods)) as never;

const isMethodsFn = (value: unknown): value is StoreMethodsFn<StoreShapes> =>
  typeof value === "function";

const isShapeRecord = (value: unknown): value is StoreShapes =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !isStoreContractValue(value) &&
  !isMethodsFn(value);

const extendCore = <
  const Base extends StoreContractValue,
  const Shapes extends StoreShapes | undefined = undefined,
>(
  base: Base,
  shapes?: Shapes,
  methods?: Shapes extends StoreShapes
    ? StoreMethodsFn<Base["shapes"] & Shapes>
    : StoreMethodsFn<Base["shapes"]>,
): StoreContractValue<
  Shapes extends StoreShapes ? Base["shapes"] & Shapes : Base["shapes"],
  MergedCustom<
    Base,
    Shapes extends StoreShapes
      ? StoreMethodsFn<Base["shapes"] & Shapes> | undefined
      : StoreMethodsFn<Base["shapes"]> | undefined
  >
> => mergeStoreContracts(base, shapes, methods) as StoreContractValue<
  Shapes extends StoreShapes ? Base["shapes"] & Shapes : Base["shapes"],
  MergedCustom<
    Base,
    Shapes extends StoreShapes
      ? StoreMethodsFn<Base["shapes"] & Shapes> | undefined
      : StoreMethodsFn<Base["shapes"]> | undefined
  >
>;

/**
 * Extend a contract — shapes, methods, or both. Pipeable.
 *
 * @public
 */
export const extend: {
  <const Shapes extends StoreShapes>(
    shapes: Shapes,
  ): <const Base extends StoreContractValue>(
    base: Base,
  ) => StoreContractValue<Base["shapes"] & Shapes, Base["custom"]>;
  <const Base extends StoreContractValue>(
    methods: StoreMethodsFn<Base["shapes"]>,
  ): (base: Base) => StoreContractValue<Base["shapes"], MergedCustom<Base, StoreMethodsFn<Base["shapes"]>>>;
  <const Shapes extends StoreShapes, const Base extends StoreContractValue>(
    shapes: Shapes,
    methods: StoreMethodsFn<Base["shapes"] & Shapes>,
  ): (base: Base) => StoreContractValue<
    Base["shapes"] & Shapes,
    MergedCustom<Base, StoreMethodsFn<Base["shapes"] & Shapes>>
  >;
  <const Shapes extends StoreShapes, const Base extends StoreContractValue>(
    shapes: Shapes,
    base: Base,
  ): StoreContractValue<Base["shapes"] & Shapes, Base["custom"]>;
  <const Base extends StoreContractValue>(
    methods: StoreMethodsFn<Base["shapes"]>,
    base: Base,
  ): StoreContractValue<Base["shapes"], MergedCustom<Base, StoreMethodsFn<Base["shapes"]>>>;
  <const Shapes extends StoreShapes, const Base extends StoreContractValue>(
    shapes: Shapes,
    methods: StoreMethodsFn<Base["shapes"] & Shapes>,
    base: Base,
  ): StoreContractValue<
    Base["shapes"] & Shapes,
    MergedCustom<Base, StoreMethodsFn<Base["shapes"] & Shapes>>
  >;
} = ((first: unknown, second?: unknown, third?: unknown) => {
  if (isMethodsFn(first) && second === undefined) {
    return <const Base extends StoreContractValue>(base: Base) => extendCore(base, undefined, first);
  }
  if (isShapeRecord(first) && isMethodsFn(second) && third === undefined) {
    return <const Base extends StoreContractValue>(base: Base) =>
      extendCore(base, first, second as StoreMethodsFn<Base["shapes"] & typeof first>);
  }
  if (isShapeRecord(first) && second === undefined) {
    return <const Base extends StoreContractValue>(base: Base) => extendCore(base, first);
  }
  if (isMethodsFn(first) && isStoreContractValue(second)) {
    return extendCore(second, undefined, first);
  }
  if (isShapeRecord(first) && isMethodsFn(second) && isStoreContractValue(third)) {
    return extendCore(third, first, second);
  }
  if (isShapeRecord(first) && isStoreContractValue(second)) {
    return extendCore(second, first);
  }
  throw new Error("Store.extend: invalid arguments");
}) as never;

// ============================================================================
// Registration log-level pipe modifiers
// ============================================================================

/** @public */
export const logLevelAll = <R extends StoreRegistrationAny>(registration: R): R =>
  withRegistrationLogLevel(registration, "All");

/** @public */
export const logLevelDebug = <R extends StoreRegistrationAny>(registration: R): R =>
  withRegistrationLogLevel(registration, "Debug");

/** @public */
export const logLevelInfo = <R extends StoreRegistrationAny>(registration: R): R =>
  withRegistrationLogLevel(registration, "Info");

/** @public */
export const logLevelWarn = <R extends StoreRegistrationAny>(registration: R): R =>
  withRegistrationLogLevel(registration, "Warn");

/** @public */
export const logLevelError = <R extends StoreRegistrationAny>(registration: R): R =>
  withRegistrationLogLevel(registration, "Error");

/** @public */
export const logLevelNone = <R extends StoreRegistrationAny>(registration: R): R =>
  withRegistrationLogLevel(registration, "None");

/** @public */
export const logLevel = logLevelAll;

// ============================================================================
// Retention pipe modifiers
// ============================================================================

/**
 * Cap how many rows a scope keeps — oldest rows are trimmed after each append.
 *
 * @example
 * ```ts
 * Store.register("events", contract).pipe(Store.retention(500))
 * ```
 *
 * @public
 */
export const retention =
  (maxRows: number) =>
  <R extends StoreRegistrationAny>(registration: R): R =>
    withRegistrationRetention(registration, maxRows);

// ============================================================================
// Change stream
// ============================================================================

/**
 * Stream append events for a registered scope — one {@link StoreChangeEvent} per successful append.
 *
 * Requires a {@link Service.layer} / {@link store.layer} that installed the scope bridge.
 *
 * @example
 * ```ts
 * const events = yield* Store.changes("thermometer");
 * yield* Stream.runForEach(events, (event) =>
 *   Effect.log(`append ${event.method} on ${event.scopeKey}`),
 * );
 * ```
 *
 * @public
 */
export const changes = (
  scope: string | StoreScopeTag,
): Effect.Effect<
  Stream.Stream<StoreChangeEvent, StoreJournalDecodeError>,
  StoreScopeNotRegistered,
  StoreScopeBridgeTag | Scope
> =>
  Effect.flatMap(StoreScopeBridgeTag, (bridge) =>
    bridge.changes(typeof scope === "string" ? scope : scope.key),
  );

// ============================================================================
// Aggregate factories
// ============================================================================

/** Aggregate store class produced by {@link Service}. @public */
export type ServiceClass<
  Self = unknown,
  Id extends string = string,
> = StoreServiceClass<Self, Id>;

/** Registration-only aggregate (no layers) — browser-safe descriptor / remote client base. @public */
export type TagClass<
  Self = unknown,
  Id extends string = string,
> = StoreTagClass<Self, Id>;

/**
 * Declare an aggregate store bundle — **class extends** with {@link layerMemory} / {@link layer}.
 *
 * `layerMemory` uses in-memory refs. `layer({ filename })` persists to SQLite; omit `filename` for memory.
 *
 * @example
 * ```ts
 * class AppStore extends Store.Service<AppStore>("@app/Store")(
 *   Store.register("metrics", contract),
 * ) {}
 *
 * Effect.provide(program, AppStore.layer({ filename: "data.sqlite" }));
 * ```
 *
 * @public
 */
export const Service = <Self>(id: string) =>
  defineStoreService<Self, typeof id extends string ? typeof id : never>(id);

/**
 * Like {@link Service} without layers — registration descriptor for remote clients.
 *
 * @public
 */
export const Tag = <Self>(id: string) =>
  defineStoreTag<Self, typeof id extends string ? typeof id : never>(id);

/**
 * Apply a store-wide default durable log export level (registration pipe overrides still win).
 *
 * @public
 */
export const withDefaultLogLevel =
  (logLevel: StoreLogLevel) =>
  <T extends StoreServiceClass>(storeClass: T): T =>
    applyStoreDefaultLogLevel(storeClass, logLevel) as T;

/** @public */
export const logLevelAllDefault = withDefaultLogLevel("All");

/** @public */
export const logLevelDebugDefault = withDefaultLogLevel("Debug");

/** @public */
export const logLevelInfoDefault = withDefaultLogLevel("Info");

/** @public */
export const logLevelWarnDefault = withDefaultLogLevel("Warn");

/** @public */
export const logLevelErrorDefault = withDefaultLogLevel("Error");

/** @public */
export const logLevelNoneDefault = withDefaultLogLevel("None");

/**
 * Default in-memory store bridge — materializes any scope on demand. Provide at the app root when
 * composing resource layers that persist run/process/queue events. A {@link Service.layer} overrides
 * this by plain layer merge.
 *
 * @public
 */
export { layerDefaultMemory };

// ============================================================================
// Standalone + tag attachment
// ============================================================================

/** Standalone single-scope store class from {@link store}. @public */
export type Standalone<
  Self,
  Id extends string,
  K extends string,
  C extends StoreContractValue,
> = StandaloneStoreClass<Self, Id, K, C>;

/**
 * Standalone store for one scope, or attach a public spec to a resource tag (pipe form).
 *
 * Standalone classes expose `layerMemory` and `layer({ filename? })` like {@link Service}.
 * Tag attachment adds `yield* Tag.store` resolved through the aggregate bridge.
 *
 * @public
 */
export const store: {
  <
    const Scope extends string | StoreScopeTag,
    const C extends StoreContractValue,
  >(
    scope: Scope,
    contract: C,
  ): StandaloneStoreClass<
    { readonly _tag: ScopeKeyOf<Scope> },
    `@nikscripts/effect-pm/Store/scope/${ScopeKeyOf<Scope>}`,
    ScopeKeyOf<Scope>,
    C,
    Scope extends StoreScopeTag ? Scope : undefined
  >;
  <const C extends StoreContractValue>(
    contract: C,
  ): <T extends StoreScopeTag>(tag: T) => T & {
    readonly store: Effect.Effect<
      StoreHandleFromContract<C>,
      StoreScopeNotRegistered,
      StoreScopeBridgeTag
    >;
  };
} = ((scopeOrContract: string | StoreScopeTag | StoreContractValue, maybeContract?: StoreContractValue) => {
  if (maybeContract !== undefined) {
    return defineStandaloneStore(scopeOrContract as string | StoreScopeTag, maybeContract);
  }
  const contract = scopeOrContract as StoreContractValue;
  return <T extends StoreScopeTag>(tag: T) =>
    Object.assign(tag, {
      store: Effect.flatMap(StoreScopeBridgeTag, (bridge) => bridge.at(tag.key, contract)),
    });
}) as never;

/**
 * Register a scope on an aggregate {@link Service} without creating a standalone class.
 *
 * @public
 */
export const register = <
  const Scope extends string | StoreScopeTag,
  const C extends StoreContractValue,
>(
  scope: Scope,
  contract: C,
): RegisteredWithContract<
  ScopeKeyOf<Scope>,
  C["spec"],
  C,
  Scope extends StoreScopeTag ? Scope : undefined
> =>
  makeRegistration(scope, contract) as unknown as RegisteredWithContract<
    ScopeKeyOf<Scope>,
    C["spec"],
    C,
    Scope extends StoreScopeTag ? Scope : undefined
  >;

// ============================================================================
// Namespace type helpers
// ============================================================================

/** @public */
export declare namespace Store {
  /** @public */
  export type Contract<C extends StoreContractValue = StoreContractValue> = C;

  /** @public */
  export type HandleOf<C extends StoreContractValue> = StoreHandleFromContract<C>;

  /** @public */
  export type Shapes = StoreShapes;

  /** @public */
  export type HandleForKey<
    Regs extends ReadonlyArray<StoreRegistrationAny>,
    K extends string,
  > = StoreHandleForKey<Regs, K>;

  /** @public */
  export type ServiceClass<
    Self = unknown,
    Id extends string = string,
  > = StoreServiceClass<Self, Id>;

  /** @public */
  export type TagClass<
    Self = unknown,
    Id extends string = string,
  > = StoreTagClass<Self, Id>;

  /** @public */
  export type Standalone<
    Self,
    Id extends string,
    K extends string,
    C extends StoreContractValue,
  > = StandaloneStoreClass<Self, Id, K, C>;

  /** Scope keys (tuple registrations) or accessor keys (object registrations) on a store class. @public */
  export type KeysOf<T> = T extends { readonly [storeRegsSym]: infer Regs }
    ? Regs extends ReadonlyArray<{ readonly scopeKey: infer K extends string }>
      ? K
      : Regs extends Record<string, { readonly scopeKey: infer K extends string }>
        ? K
        : never
    : never;
}
