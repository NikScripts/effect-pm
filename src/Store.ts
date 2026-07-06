/**
 * **Store** — scoped append/query persistence registrations backed by a shared {@link Service}.
 *
 * @remarks
 * Declare an aggregate with {@link Service} (class extends) when related scopes share one database.
 * For a single resource scope, prefer standalone {@link store} (`yield* myResourceStore`).
 *
 * @example Shape-first contract
 * ```ts
 * const thermometerContract = Store.contract({
 *   readings: Store.shape(readingSchema, Schema.Struct({
 *     limit: Schema.optional(Schema.Number),
 *   })),
 * });
 *
 * const store = yield* Resource.store("store", thermometerContract);
 * yield* store.readings.append({ value: 72 });
 * yield* store.readings.read({ limit: 10 });
 *
 * // Optional flat aliases or custom Effects in part 2:
 * // listAudits: audit.read
 * // snapshot: audit.read()
 * ```
 *
 * @module Store
 */

import { Effect, Schema } from "effect";
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
import { StoreScopeNotRegistered } from "./internal/store/errors";
import {
  makeRegistration,
  type RegisteredWithContract,
  type ScopeKeyOf,
  type StoreRegistrationAny,
  type StoreScopeTag,
  withRegistrationLogLevel,
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

export { StoreDuplicateScopeKey, StoreScopeNotRegistered } from "./internal/store/errors";

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
 * Part 2 optionally adds flat aliases, bare Effects, or effect functions.
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
      store: Effect.flatMap(StoreScopeBridgeTag, (bridge) =>
        bridge.at(tag.key, contract.spec, contract),
      ),
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
