/**
 * **Store** — scoped append/query persistence registrations backed by a shared {@link Service}.
 *
 * @remarks
 * Apps declare one {@link Service} per DB file. Registrations are passed as a single array or as
 * rest args after the store id. Each registration is scoped by a resource tag key or a custom
 * string key.
 *
 * The factory return value is **callable** — `yield* AppStore("custom-key")` or
 * `yield* AppStore(MyTag)` — and only accepts keys registered on that store. Assign it to a
 * `const` (RunResource-style) or `class extends` it for nominal branding; keyed acquire uses the
 * callable directly, or {@link acquire} when the subclass constructor is not invokable.
 *
 * @example
 * ```ts
 * export const DropletStore = Store.Service<DropletStore>("@repo/app/Store")(
 *   Resource.store(LabThermometer, thermometerStore),
 *   Resource.store("custom-store", thermometerStore),
 * );
 *
 * const store = yield* DropletStore("custom-store");
 * yield* store.readings({ value: 72 });
 * ```
 *
 * @module Store
 */

import { Data, Effect, Layer, Context } from "effect";
import {
  applyStoreDefaultLogLevel,
  defineStoreService,
  storeRegsSym,
  type StoreServiceClass,
} from "./internal/store/aggregateService";
import {
  makeRegistration,
  type RegisteredKeys as RegisteredKeysType,
  type ScopeKeyOf,
  type StoreRegistration,
  type StoreRegistrationAny,
  type StoreScopeTag,
  type TagForKey as TagForKeyType,
  withRegistrationLogLevel,
} from "./internal/store/registration";
import { storeAppend, storeQuery } from "./internal/store/builders";
import {
  type StoreHandleForKey,
  type StoreHandleOf,
  type StoreSpec,
} from "./internal/store/spec";
import { mergeSpecs, type MergeSpecTuple as MergeSpecTupleType } from "./internal/store/specMerge";
import type { StoreLogLevel } from "./internal/store/types";

export type { StoreLayerOptions, StoreLogLevel } from "./internal/store/types";
export type MergeSpecTuple<Specs extends ReadonlyArray<StoreSpec>> = MergeSpecTupleType<Specs>;

// ============================================================================
// Errors
// ============================================================================

/**
 * No registration exists for the requested scope key on this store class.
 *
 * @public
 */
export class StoreScopeNotRegistered extends Data.TaggedError("StoreScopeNotRegistered")<{
  readonly key: string;
}> {}

// ============================================================================
// Spec builders
// ============================================================================

/**
 * Append-only store method — `(payload) => Effect<void>`.
 *
 * @public
 */
export const append = storeAppend;

/**
 * Query store method — `(payload) => Effect<result>`.
 *
 * Pass `from` when the scope has multiple append streams; otherwise the sole append stream is inferred.
 *
 * @public
 */
export const query = storeQuery;

/**
 * Type-only name for a store spec object. Call sites can use a bare object literal;
 * {@link extend} composes specs without {@link Store.contract}.
 *
 * @example
 * ```ts
 * const auditSpec: Store.Contract<{
 *   campaignAudit: ReturnType<typeof Store.append<typeof campaignAuditSchema>>;
 * }> = {
 *   campaignAudit: Store.append(campaignAuditSchema),
 * };
 * ```
 *
 * @public
 */
export type Contract<S extends StoreSpec> = S;

/**
 * Extend a store spec with more methods — repeatable (`extend(extend(a, b), c)`).
 *
 * @example
 * ```ts
 * QueueResource.store(Mail, Store.extend(baseAuditSpec, {
 *   campaignAudit: Store.append(campaignAuditSchema),
 * }))
 *
 * QueueResource.store(Mail, {
 *   campaignAudit: Store.append(campaignAuditSchema),
 * })
 * ```
 *
 * @public
 */
export const extend = <
  const Specs extends ReadonlyArray<StoreSpec>,
>(
  ...specs: Specs
): MergeSpecTupleType<Specs> => mergeSpecs(...specs);

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
// Service factory
// ============================================================================

/** Callable store class produced by {@link Service}. @public */
export type ServiceClass<
  Self,
  Regs extends ReadonlyArray<StoreRegistrationAny>,
> = StoreServiceClass<Self, Regs>;

/**
 * Declare an app store — identity first, registrations second (array or rest args).
 *
 * @public
 */
export const Service = <Self>(id: string) =>
  defineStoreService<Self, typeof StoreBacking>(StoreBacking)(id);

/**
 * Acquire a scoped store handle from a {@link Service} registration table.
 *
 * @public
 */
export const acquire = <
  Self,
  Regs extends ReadonlyArray<StoreRegistrationAny>,
  K extends RegisteredKeysType<Regs>,
>(
  store: StoreServiceClass<Self, Regs>,
  key: K | TagForKeyType<Regs, K>,
): Effect.Effect<
  StoreHandleForKey<Regs, K>,
  StoreScopeNotRegistered,
  Self
> => store(key);

/**
 * Apply a store-wide default durable log export level (registration pipe overrides still win).
 *
 * @public
 */
export const withDefaultLogLevel =
  (logLevel: StoreLogLevel) =>
  <T extends StoreServiceClass<any, any, typeof StoreBacking>>(storeClass: T): T =>
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
// Resource.store registration (also exported from Resource)
// ============================================================================

/**
 * Register store facets on an app {@link Service} (`scope`, `spec`) or attach a public spec to a
 * resource tag (pipe form — `spec` only).
 *
 * @public
 */
export const store: {
  <const S extends StoreSpec>(spec: S): <T extends StoreScopeTag>(tag: T) => T & {
    readonly store: Effect.Effect<StoreHandleOf<S>, StoreScopeNotRegistered, StoreBacking>;
  };
  <
    const Scope extends string | StoreScopeTag,
    const S extends StoreSpec,
  >(
    scope: Scope,
    spec: S,
  ): StoreRegistration<ScopeKeyOf<Scope>, S>;
} = ((scopeOrSpec: string | StoreScopeTag | StoreSpec, maybeSpec?: StoreSpec) => {
  if (maybeSpec !== undefined) {
    return makeRegistration(scopeOrSpec as string | StoreScopeTag, maybeSpec);
  }
  const spec = scopeOrSpec as StoreSpec;
  return <T extends StoreScopeTag>(tag: T) =>
    Object.assign(tag, {
      store: acquireForTag(tag.key, spec),
    });
}) as never;

/** @internal */
const acquireForTag = <S extends StoreSpec>(
  key: string,
  spec: S,
): Effect.Effect<StoreHandleOf<S>, StoreScopeNotRegistered, StoreBacking> =>
  Effect.flatMap(StoreBacking, (backing) => backing.acquire(key, spec));

/**
 * Bridge so resource tags can `yield* Tag.store` against whichever app store is provided.
 *
 * @public
 */
export class StoreBacking extends Context.Service<StoreBacking, {
  readonly acquire: <S extends StoreSpec>(
    key: string,
    spec: S,
  ) => Effect.Effect<StoreHandleOf<S>, StoreScopeNotRegistered>;
}>()("@nikscripts/effect-pm/Store/StoreBacking") {}

/**
 * Provide {@link StoreBacking} from an app {@link Service} (alias of `store.backingLayer`).
 *
 * @public
 */
export const backingLayer = <
  Self,
  Regs extends ReadonlyArray<StoreRegistrationAny>,
>(
  store: StoreServiceClass<Self, Regs, StoreBacking>,
): Layer.Layer<StoreBacking, never, Self> => store.backingLayer;

// ============================================================================
// Namespace type helpers
// ============================================================================

/** @public */
export declare namespace Store {
  /** Type-only name for a store spec. @public */
  export type Contract<S extends StoreSpec> = S;

  /** @public */
  export type MergeSpecTuple<Specs extends ReadonlyArray<StoreSpec>> = MergeSpecTupleType<Specs>;

  /** @public */
  export type HandleOf<S extends StoreSpec> = StoreHandleOf<S>;

  /** @public */
  export type RegisteredKeys<Regs extends ReadonlyArray<StoreRegistrationAny>> =
    RegisteredKeysType<Regs>;

  /** @public */
  export type TagForKey<
    Regs extends ReadonlyArray<StoreRegistrationAny>,
    K extends string,
  > = TagForKeyType<Regs, K>;

  /** @public */
  export type HandleForKey<
    Regs extends ReadonlyArray<StoreRegistrationAny>,
    K extends RegisteredKeysType<Regs>,
  > = StoreHandleForKey<Regs, K>;

  /** @public */
  export type KeysOf<T> = T extends {
    readonly [storeRegsSym]: infer Regs extends ReadonlyArray<StoreRegistrationAny>;
  }
    ? RegisteredKeysType<Regs>
    : never;

  /** @public */
  export type ServiceClass<
    Self,
    Regs extends ReadonlyArray<StoreRegistrationAny>,
  > = StoreServiceClass<Self, Regs>;
}
