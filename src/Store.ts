/**
 * **Store** — scoped append/query persistence registrations backed by a shared {@link Service}.
 *
 * @remarks
 * ## Mental model
 *
 * A **contract** declares named **shapes** (row schema). Each shape becomes
 * `store.<shape>.append` and `store.<shape>.read` on the materialized handle. Every `.read` shares
 * one baked-in payload (`limit` / time window / Drizzle-RQB nested `where`). Part 2 of
 * {@link contract} may add flat aliases, bare {@link Effect}s, or effect functions — never raw
 * `readWith` helpers.
 *
 * ## Layers
 *
 * - {@link Service.layerMemory} / {@link store.layerMemory} — `EventJournal.layerMemory` (process-local) + Logs.
 * - {@link Service.layer} / {@link store.layer} with **required** `{ filename }` — SQLite via `SqlEventJournal`
 *   (`effect/unstable/eventlog`) on `@effect/sql-sqlite-node`.
 *
 * Toolkit engines (`Process.layer`, …) **require** {@link Storage}. Provide your {@link Service} with
 * `Layer.provide` / `provideMerge` (see `docs/guides/stores.md`). Use `Process.layerMemory` only for
 * ephemeral engine observability without an app store (`layerDefaultMemory` — no Logs).
 *
 * Register scopes on an aggregate with {@link register} or {@link scoped}.
 * Resolve handles with `yield* MyStore.at(Tag)` (tag-first) or `yield* tag.store` when the tag
 * carries a `.store` attachment. Standalone {@link store} yields a single-scope handle directly.
 *
 * ## Observability
 *
 * {@link changes} streams {@link StoreChangeEvent} on every successful append (operator plumbing).
 * {@link retention} caps row count per registration — oldest rows drop after each append.
 *
 * ## Engine authoring
 *
 * Toolkit engines declare {@link Storage} as a dependency. Soft-default only via toolkit
 * `*Memory` layers (`Layer.provideMerge(Store.layerDefaultMemory)`). Prefer
 * `engine.layer(…).pipe(Layer.provideMerge(AppStore.layer…))` so capture sees your store.
 *
 * @example Shape-first contract
 * ```ts
 * import * as Store from "@nikscripts/effect-pm/Store";
 * import * as Schema from "effect/Schema";
 *
 * const thermometerContract = Store.contract({
 *   readings: Store.shape(Schema.Struct({ value: Schema.Number })),
 * });
 *
 * class AppStore extends Store.Service<AppStore>("@app/Store")(
 *   Store.register("thermometer", thermometerContract),
 * ) {}
 *
 * const program = Effect.gen(function* () {
 *   const handle = yield* AppStore.at("thermometer");
 *   yield* handle.readings.append({ value: 72 });
 *   const rows = yield* handle.readings.read({
 *     limit: 10,
 *     where: { value: { gte: 70 } },
 *   });
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

import { Context, Effect, Layer, Option, Predicate, Schema, Scope, Stream } from "effect";
import * as EventJournal from "effect/unstable/eventlog/EventJournal";
import * as SqlEventJournal from "effect/unstable/eventlog/SqlEventJournal";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { LogRelay, layer as logsLayer } from "./internal/logs/relay";
import type { LogRelayService } from "./internal/logs/relay";
import {
  buildStandaloneRegistration,
  defineStandaloneStore,
  defineStoreTag,
  isSingleStoreTagClass,
  storeDefaultLogLevelSym,
  storeRegsSym,
  type SingleStoreTagClass,
  type StandaloneStoreClass,
  type StoreBundle,
  type StoreTagClass,
} from "./internal/store/defineStore";
import type {
  ContractForSingleInput,
  IsSingleStoreInput,
  RegsOfStoreInput,
} from "./internal/store/registrationTypes";
import type { StorageApi } from "./internal/store/bridge";
import { buildDefaultScopeBridge, buildScopeBridge } from "./internal/store/scopeBridge";
import { buildScopeStateMap, type ScopeState } from "./internal/store/memoryScope";
import { buildBundle, mapSqliteBuildError } from "./internal/store/sqliteLayer";
import type { NormalizedStoreRegistration } from "./internal/store/registrationNormalize";
import { layersForRegistrations as logTailLayersForRegistrations } from "./internal/logs/durableTail";
import {
  StoreScopeNotRegistered,
  StoreChangeEvent,
  StoreJournalDecodeError,
  StoreWriteError,
  type StoreSqliteConnectionError,
} from "./internal/store/errors";
import {
  makeRegistration,
  type RegisteredWithContract,
  type ScopeKeyOf,
  type StoreRegistrationAny,
  type StoreScopeTag,
  withRegistrationLogLevel,
  withRegistrationRetention,
  withRegistrationStreamLevel,
} from "./internal/store/registration";
import {
  isStoreContractValue,
  makeShapeRefs,
  makeStoreContractValue,
  makeStoreShape,
  mergeStoreContracts,
  nestHandle,
  resolveShapeRef,
  shapeRowsByKey,
  type AllShapeRows,
  type MergedCustom,
  type SchemaDecoded,
  type ShapeHandles,
  type ShapeRef,
  type ShapeRefs,
  type ShapesOfStore,
  type StoreClassWithShapes,
  type StoreContractValue,
  type StoreMethodsFn,
  type StoreShapeDef,
  type StoreShapes,
} from "./internal/store/contract";
import {
  type StoreHandleForKey,
  type StoreHandleFromContract,
  type StoreHandleOf,
} from "./internal/store/spec";
import type { StoreLayerOptions, StoreLogLevel } from "./internal/store/types";

export type { StoreLayerOptions, StoreLogLevel } from "./internal/store/types";
export type { StoreHandleFromContract } from "./internal/store/spec";
export type { ExtendCustom, MergedCustom, MethodsReturn, StoreContractValue, StoreMethodsFn, StoreShapeDef, StoreShapeInput, StoreShapes } from "./internal/store/contract";
export type { StoreReadPayload, WhereFilter, WhereOperators, WhereField } from "./internal/store/where";

export { StoreDuplicateScopeKey, StoreScopeNotRegistered, StoreChangeEvent, StoreWriteError } from "./internal/store/errors";

// ============================================================================
// Storage service tag + layers
// ============================================================================
//
// The `Storage` service is co-located with its layer builders here (Effect's
// service-with-layers pattern, like `EventJournal` holds the tag + `layerMemory`).

/**
 * Scope bridge every store handle resolves through — provided by an app {@link Service} layer or
 * {@link layerDefaultMemory}. Toolkit and third-party engines declare this as a dependency and
 * resolve handles via {@link withDefault} / {@link withStorage} (preferred) or `bridge.at`.
 *
 * @example Engine — resolve once at layer build
 * ```ts
 * const store = yield* Store.resolveOrDie(tag.key, builtInMyStoreContract(tag));
 * yield* store.record(event);
 * ```
 *
 * @public
 */
export class Storage extends Context.Service<Storage, StorageApi>()(
  "@nikscripts/effect-pm/Store/Storage",
) {}

/**
 * API carried by {@link Storage}: materialize a typed handle for a `scopeKey` + contract.
 *
 * @public
 */
export type { StorageApi } from "./internal/store/bridge";

/** Layer attachments shared by aggregate and standalone store classes. @internal */
type StoreLayers<Self> = {
  /** Includes {@link LogRelay} + capture logger (durable log tails). */
  readonly layerMemory: Layer.Layer<Self | Storage | LogRelay>;
  readonly layer: (
    options: StoreLayerOptions,
  ) => Layer.Layer<Self | Storage | LogRelay, StoreSqliteConnectionError, Scope.Scope>;
};

/** Aggregate store class with attached {@link Storage} layers. @internal */
export type StoreServiceClass<
  Self = unknown,
  Id extends string = string,
  Regs = ReadonlyArray<NormalizedStoreRegistration>,
> = StoreTagClass<Self, Id, Regs> & StoreLayers<Self>;

/** Single-registration store class with attached {@link Storage} layers. @internal */
export type SingleStoreServiceClass<
  Self = unknown,
  Id extends string = string,
  C extends StoreContractValue = StoreContractValue,
> = SingleStoreTagClass<Self, Id, C> & StoreLayers<Self>;

/** Standalone single-scope store class with attached {@link Storage} layers. @internal */
export type StandaloneStore<
  Self,
  Id extends string,
  K extends string = string,
  C extends StoreContractValue = StoreContractValue,
  Tag extends StoreScopeTag | undefined = undefined,
> = StandaloneStoreClass<Self, Id, K, C, Tag> & StoreLayers<Self>;

/** @internal */
const layerFromBuiltBridge = <
  Self,
  Id extends string,
  Regs,
>(
  tag: Context.ServiceClass<Self, Id, StoreBundle<Regs>>,
  bundle: StoreBundle<Regs>,
  bridge: StorageApi,
  registrations: ReadonlyArray<NormalizedStoreRegistration>,
  relay: Option.Option<LogRelayService>,
): Layer.Layer<Self | Storage> =>
  Layer.mergeAll(
    Layer.succeed(tag, bundle as unknown as StoreBundle<Regs>),
    Layer.succeed(Storage, bridge),
    logTailLayersForRegistrations(
      registrations,
      bundle as unknown as Readonly<Record<string, unknown>>,
      relay,
    ),
  );

/** @internal */
const layerForSingleRegistration = <
  Self,
  Id extends string,
  C extends StoreContractValue,
>(
  tag: Context.ServiceClass<Self, Id, StoreHandleFromContract<C>>,
  registration: NormalizedStoreRegistration,
  scopes: Map<string, ScopeState>,
): Layer.Layer<Self | Storage, never, EventJournal.EventJournal> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const journal = yield* EventJournal.EventJournal;
      const relay = yield* Effect.serviceOption(LogRelay);
      const bridge = buildScopeBridge(scopes, journal);
      const handle = yield* bridge
        .at(registration.scopeKey, registration.contract ?? registration.spec)
        .pipe(Effect.orDie);
      return Layer.mergeAll(
        Layer.succeed(tag, handle as unknown as StoreHandleFromContract<C>),
        Layer.succeed(Storage, bridge),
        logTailLayersForRegistrations(
          [registration],
          { [registration.accessor]: handle },
          relay,
        ),
      );
    }),
  );

/** @internal */
const buildStandaloneMemoryLayer = <
  Self,
  Id extends string,
  C extends StoreContractValue,
>(
  tag: Context.ServiceClass<Self, Id, StoreHandleFromContract<C>>,
  registration: NormalizedStoreRegistration,
): Layer.Layer<Self | Storage | LogRelay> =>
  layerForSingleRegistration(tag, registration, buildScopeStateMap([registration])).pipe(
    Layer.provide(EventJournal.layerMemory),
    Layer.provideMerge(logsLayer),
  );

/** @internal */
const buildStandaloneSqliteLayer = <
  Self,
  Id extends string,
  C extends StoreContractValue,
>(
  tag: Context.ServiceClass<Self, Id, StoreHandleFromContract<C>>,
  registration: NormalizedStoreRegistration,
  filename: string,
): Layer.Layer<Self | Storage | LogRelay, StoreSqliteConnectionError, Scope.Scope> => {
  const scopes = buildScopeStateMap([registration]);
  const sqlStack = Layer.provideMerge(
    SqlEventJournal.layer(),
    SqliteClient.layer({ filename }),
  );
  return Layer.unwrap(
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const context = yield* Layer.buildWithScope(sqlStack, scope).pipe(
        Effect.mapError(mapSqliteBuildError),
      );
      const journal = Context.get(context, EventJournal.EventJournal);
      const bridge = buildScopeBridge(scopes, journal);
      const handle = yield* bridge
        .at(registration.scopeKey, registration.contract ?? registration.spec)
        .pipe(Effect.orDie);
      const relay = yield* Effect.serviceOption(LogRelay);
      return Layer.mergeAll(
        Layer.succeed(tag, handle as unknown as StoreHandleFromContract<C>),
        Layer.succeed(Storage, bridge),
        logTailLayersForRegistrations(
          [registration],
          { [registration.accessor]: handle },
          relay,
        ),
      ).pipe(Layer.provide(Layer.succeedContext(context)));
    }).pipe(Effect.mapError(mapSqliteBuildError)),
  ).pipe(Layer.provideMerge(logsLayer));
};

/** @internal */
const layerFromScopeState = <
  Self,
  Id extends string,
  Regs,
>(
  tag: Context.ServiceClass<Self, Id, StoreBundle<Regs>>,
  registrations: ReadonlyArray<NormalizedStoreRegistration>,
  scopes: Map<string, ScopeState>,
): Layer.Layer<Self | Storage, never, EventJournal.EventJournal> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const journal = yield* EventJournal.EventJournal;
      const relay = yield* Effect.serviceOption(LogRelay);
      const bridge = buildScopeBridge(scopes, journal);
      const bundle = yield* buildBundle(registrations, bridge.at).pipe(Effect.orDie);
      return layerFromBuiltBridge(
        tag,
        bundle as StoreBundle<Regs>,
        bridge,
        registrations,
        relay,
      );
    }),
  );

/** @internal */
const buildMemoryLayerForAggregate = <
  Self,
  Id extends string,
  Regs,
>(
  tag: Context.ServiceClass<Self, Id, StoreBundle<Regs>>,
  registrations: ReadonlyArray<NormalizedStoreRegistration>,
): Layer.Layer<Self | Storage | LogRelay> => {
  const scopes = buildScopeStateMap(registrations);
  return layerFromScopeState(tag, registrations, scopes).pipe(
    Layer.provide(EventJournal.layerMemory),
    Layer.provideMerge(logsLayer),
  );
};

/** @internal */
const buildSqliteLayerForAggregate = <
  Self,
  Id extends string,
  Regs,
>(
  tag: Context.ServiceClass<Self, Id, StoreBundle<Regs>>,
  registrations: ReadonlyArray<NormalizedStoreRegistration>,
  filename: string,
): Layer.Layer<Self | Storage | LogRelay, StoreSqliteConnectionError, Scope.Scope> => {
  const scopes = buildScopeStateMap(registrations);
  const sqlStack = Layer.provideMerge(
    SqlEventJournal.layer(),
    SqliteClient.layer({ filename }),
  );
  return Layer.unwrap(
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const context = yield* Layer.buildWithScope(sqlStack, scope).pipe(
        Effect.mapError(mapSqliteBuildError),
      );
      const journal = Context.get(context, EventJournal.EventJournal);
      const bridge = buildScopeBridge(scopes, journal);
      const bundle = yield* buildBundle(registrations, bridge.at).pipe(Effect.orDie);
      const relay = yield* Effect.serviceOption(LogRelay);
      return layerFromBuiltBridge(
        tag,
        bundle as StoreBundle<Regs>,
        bridge,
        registrations,
        relay,
      ).pipe(
        Layer.provide(Layer.succeedContext(context)),
      );
    }).pipe(Effect.mapError(mapSqliteBuildError)),
  ).pipe(Layer.provideMerge(logsLayer));
};

/** @internal */
const buildLayerForAggregate = <
  Self,
  Id extends string,
  Regs,
>(
  tag: Context.ServiceClass<Self, Id, StoreBundle<Regs>>,
  registrations: ReadonlyArray<NormalizedStoreRegistration>,
  options: StoreLayerOptions,
): Layer.Layer<Self | Storage | LogRelay, StoreSqliteConnectionError, Scope.Scope> =>
  buildSqliteLayerForAggregate(tag, registrations, options.filename);

/** Attach `layerMemory` / `layer` to a registration-only store class. @internal */
const attachStoreLayers = <
  Self,
  Id extends string,
  Result,
>(
  storeClass: Result,
): Result & StoreLayers<Self> => {
  if (isSingleStoreTagClass(storeClass)) {
    const registrations = storeClass[storeRegsSym];
    const registration = registrations[0]!;
    const layerMemory = buildStandaloneMemoryLayer(storeClass, registration);
    const layer = (options: StoreLayerOptions) =>
      buildStandaloneSqliteLayer(storeClass, registration, options.filename);
    return Object.assign(storeClass, {
      layerMemory,
      layer,
    }) as Result & StoreLayers<Self>;
  }

  const aggregate = storeClass as StoreTagClass<Self, Id, unknown>;
  const registrations = aggregate[storeRegsSym] as ReadonlyArray<NormalizedStoreRegistration>;
  const layerMemory = buildMemoryLayerForAggregate(
    aggregate as Context.ServiceClass<Self, Id, StoreBundle<unknown>>,
    registrations,
  );
  const layer = (options: StoreLayerOptions) =>
    buildLayerForAggregate(
      aggregate as Context.ServiceClass<Self, Id, StoreBundle<unknown>>,
      registrations,
      options,
    );
  return Object.assign(storeClass as object, {
    layerMemory,
    layer,
  }) as Result & StoreLayers<Self>;
};

/** @internal */
const applyStoreDefaultLogLevel = <
  Self,
  Id extends string,
  Regs,
>(
  storeClass: StoreServiceClass<Self, Id, Regs>,
  level: StoreLogLevel,
): StoreServiceClass<Self, Id, Regs> => {
  const registrations = storeClass[storeRegsSym] as ReadonlyArray<NormalizedStoreRegistration>;
  return Object.assign(storeClass, {
    [storeDefaultLogLevelSym]: level,
    layerMemory: buildMemoryLayerForAggregate(storeClass, registrations),
    layer: (options: StoreLayerOptions) =>
      buildLayerForAggregate(storeClass, registrations, {
        ...options,
        logLevel: options.logLevel ?? level,
      }),
  });
};

/**
 * Baked-in default store layer: provides {@link Storage} from a process-local in-memory
 * `EventJournal`. Materializes any scope on demand so {@link withDefault} never fails when this
 * layer is in context. Merge into toolkit layers; apps override with `Layer.provideMerge` and a
 * registered {@link Service}.
 *
 * @public
 */
export const layerDefaultMemory: Layer.Layer<Storage> = Layer.unwrap(
  Effect.map(EventJournal.EventJournal, (journal) =>
    Layer.succeed(Storage, buildDefaultScopeBridge(journal)),
  ),
).pipe(Layer.provide(EventJournal.layerMemory));

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

/**
 * Add {@link Storage} to the requirement channel of every method in a resolved-handle shape, recursing
 * into nested sub-trees. Mirrors the `AsShape`/tree recursion so it does not trip `TS2589`: a method
 * `(...a) => Effect<S, E, R>` → `(...a) => Effect<S, E, R | Storage>`; a bare {@link Effect} custom
 * member gains `Storage` too; a sub-tree recurses; anything else passes through. @internal
 */
export type AddStorageReq<T> = T extends (
  ...args: infer A
) => Effect.Effect<infer S, infer E, infer R>
  ? (...args: A) => Effect.Effect<S, E, R | Storage>
  : T extends Effect.Effect<infer S, infer E, infer R>
    ? Effect.Effect<S, E, R | Storage>
    : T extends Record<string, unknown>
      ? { readonly [K in keyof T]: AddStorageReq<T[K]> }
      : T;

/**
 * Remove {@link StoreWriteError} from the error channel of every method in a resolved-effects shape,
 * recursing into nested sub-trees — the per-method-precise result of {@link catchWriteErrors}. A write
 * method `(...a) => Effect<S, StoreWriteError | E, R>` → `(...a) => Effect<S, E, R>`; a read (whose `E`
 * lacks `StoreWriteError`) is unchanged (`Exclude<E, StoreWriteError>` is a no-op); the
 * {@link StoreEffectsVariance} brand's non-effect members pass through (the function-passthrough branch
 * keeps `_C` intact). @internal
 */
export type CatchWriteError<T> = T extends (
  ...args: infer A
) => Effect.Effect<infer S, infer E, infer R>
  ? (...args: A) => Effect.Effect<S, Exclude<E, StoreWriteError>, R>
  : T extends Effect.Effect<infer S, infer E, infer R>
    ? Effect.Effect<S, Exclude<E, StoreWriteError>, R>
    : T extends (...args: ReadonlyArray<never>) => unknown
      ? T
      : T extends object
        ? { readonly [K in keyof T]: CatchWriteError<T[K]> }
        : T;

/**
 * Remove the requirement channel `Ctx` from every method in a resolved-effects shape, recursing into
 * nested sub-trees — the per-method-precise result of {@link provideContext}. Mirrors
 * {@link CatchWriteError}, but **subtracts** the provided context `Ctx` from each method's requirement
 * rather than catching an error — sound like `Effect.provideContext` (`R` → `Exclude<R, Ctx>`), so a
 * requirement the context does **not** cover survives as a residual (caught at a later assignment)
 * instead of being silently claimed `never`. A write method
 * `(...a) => Effect<S, E, R>` → `(...a) => Effect<S, E, Exclude<R, Ctx>>`; a bare {@link Effect} custom
 * member is subtracted too; the {@link StoreEffectsVariance} brand's non-effect members pass through
 * (the function-passthrough branch keeps `_C` intact); a sub-tree recurses. @public
 */
export type StoreProvidedContext<T, Ctx> = T extends (
  ...args: infer A
) => Effect.Effect<infer S, infer E, infer R>
  ? (...args: A) => Effect.Effect<S, E, Exclude<R, Ctx>>
  : T extends Effect.Effect<infer S, infer E, infer R>
    ? Effect.Effect<S, E, Exclude<R, Ctx>>
    : T extends (...args: ReadonlyArray<never>) => unknown
      ? T
      : T extends object
        ? { readonly [K in keyof T]: StoreProvidedContext<T[K], Ctx> }
        : T;

/**
 * Brand identifier for an {@link effects} object — Effect's v4 `TypeId` shape (a string-literal id,
 * present at runtime). @public
 */
export type TypeId = "@nikscripts/effect-pm/Store/StoreEffects";

/** @public */
export const TypeId: TypeId = "@nikscripts/effect-pm/Store/StoreEffects";

/**
 * Variance carrier for the {@link effects} brand — mirrors Effect's `Stream.Variance`. `C` is
 * **covariant** (Effect's `(_: never) => C` encoding), so a specific contract's effects satisfy the wide
 * `StoreEffectsVariance<StoreContractValue>` constraint that {@link mapEffects} / {@link catchWriteErrors}
 * take. @public
 */
export interface StoreEffectsVariance<out C extends StoreContractValue> {
  readonly [TypeId]: { readonly _C: (_: never) => C };
}

/**
 * The object of effects produced by {@link effects}: the {@link HandleOf} structure (nested shape tree +
 * custom methods) with {@link Storage} added to every method's requirement channel, carrying the
 * {@link StoreEffectsVariance} brand.
 *
 * @public
 */
export type StoreEffectsOf<C extends StoreContractValue> = AddStorageReq<StoreHandleFromContract<C>> &
  StoreEffectsVariance<C>;

/** True for a value branded as a {@link effects} object. @public */
export const isStoreEffects = (u: unknown): u is StoreEffectsOf<StoreContractValue> =>
  Predicate.hasProperty(u, TypeId);

/** Scope keys (tuple registrations) or accessor keys (object registrations) on a store class. @public */
export type KeysOf<T> = T extends { readonly [storeRegsSym]: infer Regs }
  ? Regs extends ReadonlyArray<{ readonly scopeKey: infer K extends string }>
    ? K
    : Regs extends Record<string, { readonly scopeKey: infer K extends string }>
      ? K
      : never
  : never;

/**
 * Declare a row shape. Every shape shares the baked-in read payload
 * (`limit` / `before` / `after` / nested RQB `where`).
 *
 * @public
 */
export function shape<Row extends Schema.Schema<unknown>>(row: Row): StoreShapeDef<Row> {
  return makeStoreShape(row);
}

/**
 * Declare store shapes and optional custom methods.
 *
 * Part 1 declares row shapes (each becomes `store.<shape>.append` / `.read` with the
 * baked-in read payload). Part 2 optionally adds flat aliases, bare Effects, or effect
 * functions — not `readWith` helpers.
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
> => (methods === undefined
  ? shapes === undefined
    ? mergeStoreContracts(base)
    : mergeStoreContracts(base, shapes)
  : shapes === undefined
    ? mergeStoreContracts(base, undefined, methods)
    : mergeStoreContracts(base, shapes, methods)) as StoreContractValue<
  Shapes extends StoreShapes ? Base["shapes"] & Shapes : Base["shapes"],
  MergedCustom<
    Base,
    Shapes extends StoreShapes
      ? StoreMethodsFn<Base["shapes"] & Shapes> | undefined
      : StoreMethodsFn<Base["shapes"]> | undefined
  >
>;

/**
 * Extend an existing contract with more shapes, more custom methods, or both — the composable
 * counterpart to {@link contract} (which builds one from scratch).
 *
 * **Concrete-preservation guarantee.** When a `methods` builder is supplied *together with* its
 * `base` (the data-first forms `extend(methods, base)` and `extend(shapes, methods, base)`), the
 * builder's return `Custom` is inferred at its exact type and merged as `Base["custom"] & Custom`.
 * Each method therefore keeps its precise signature all the way onto {@link effects} — e.g.
 * `completed: (entry, success, elapsed) => Effect<void, StoreWriteError, Storage>`, never a widened
 * `Record<string, unknown>`. The `methods` builder receives the base's shape handles
 * ({@link ShapeHandles} over `Base["shapes"]`, plus any newly declared `shapes`), so `event.append`
 * / `event.read` are typed for the base's own row schemas.
 *
 * The pipeable / data-last forms (`extend(methods)` and `extend(shapes, methods)`) still preserve
 * the builder's return `Custom` concretely, but — because the `base` is not yet known when the
 * builder is written — its shape handles are typed generically (the newly declared `shapes` only,
 * for `extend(shapes, methods)`). Prefer the data-first forms when methods must read base shapes.
 *
 * @example Add methods to a base contract (data-first — full concrete handles)
 * ```ts
 * const base = Store.contract({ event: eventSchema }, ({ event }) => ({
 *   record: event.append,
 *   events: event.read,
 * }));
 *
 * const extended = Store.extend(
 *   ({ event }) => ({
 *     started: (entry: Entry) => event.append({ _tag: "Started", entry }),
 *   }),
 *   base,
 * );
 * // extended["custom"].started is the exact `(entry: Entry) => Effect<void, StoreWriteError>`
 * ```
 *
 * @public
 * @category constructors
 */
export const extend: {
  <const Shapes extends StoreShapes>(
    shapes: Shapes,
  ): <const Base extends StoreContractValue>(
    base: Base,
  ) => StoreContractValue<Base["shapes"] & Shapes, Base["custom"]>;
  <const Custom extends Readonly<Record<string, unknown>>>(
    methods: (shapes: ShapeHandles<StoreShapes>) => Custom,
  ): <const Base extends StoreContractValue>(
    base: Base,
  ) => StoreContractValue<Base["shapes"], Base["custom"] & Custom>;
  <
    const Shapes extends StoreShapes,
    const Custom extends Readonly<Record<string, unknown>>,
  >(
    shapes: Shapes,
    methods: (shapes: ShapeHandles<Shapes>) => Custom,
  ): <const Base extends StoreContractValue>(
    base: Base,
  ) => StoreContractValue<Base["shapes"] & Shapes, Base["custom"] & Custom>;
  <const Shapes extends StoreShapes, const Base extends StoreContractValue>(
    shapes: Shapes,
    base: Base,
  ): StoreContractValue<Base["shapes"] & Shapes, Base["custom"]>;
  <
    const Base extends StoreContractValue,
    const Custom extends Readonly<Record<string, unknown>>,
  >(
    methods: (shapes: ShapeHandles<Base["shapes"]>) => Custom,
    base: Base,
  ): StoreContractValue<Base["shapes"], Base["custom"] & Custom>;
  <
    const Shapes extends StoreShapes,
    const Base extends StoreContractValue,
    const Custom extends Readonly<Record<string, unknown>>,
  >(
    shapes: Shapes,
    methods: (shapes: ShapeHandles<Base["shapes"] & Shapes>) => Custom,
    base: Base,
  ): StoreContractValue<Base["shapes"] & Shapes, Base["custom"] & Custom>;
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

/** Per-registration live stream floor for {@link Resource.logs} (distinct from durable {@link logLevel}). @public */
export const streamLevelAll = <R extends StoreRegistrationAny>(registration: R): R =>
  withRegistrationStreamLevel(registration, "All");

/** @public */
export const streamLevelDebug = <R extends StoreRegistrationAny>(registration: R): R =>
  withRegistrationStreamLevel(registration, "Debug");

/** @public */
export const streamLevelInfo = <R extends StoreRegistrationAny>(registration: R): R =>
  withRegistrationStreamLevel(registration, "Info");

/** @public */
export const streamLevelWarn = <R extends StoreRegistrationAny>(registration: R): R =>
  withRegistrationStreamLevel(registration, "Warn");

/** @public */
export const streamLevelError = <R extends StoreRegistrationAny>(registration: R): R =>
  withRegistrationStreamLevel(registration, "Error");

/** @public */
export const streamLevelNone = <R extends StoreRegistrationAny>(registration: R): R =>
  withRegistrationStreamLevel(registration, "None");

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
 * Decode a change-event payload against a shape's row schema, re-tagging failures. A bare
 * `Schema.Schema<unknown>` carries `DecodingServices: unknown`, so the decode requirement is
 * `unknown` here; the public {@link changes} overloads pin the stream requirement to `never`
 * independently, so callers never see it. @internal
 */
const decodeChangeRow = (
  row: Schema.Schema<unknown>,
  payload: unknown,
): Effect.Effect<unknown, StoreJournalDecodeError, unknown> =>
  Schema.decodeUnknownEffect(Schema.toCodecJson(row))(payload).pipe(
    Effect.mapError(
      (cause) =>
        new StoreJournalDecodeError({
          cause,
          detail: "Failed to decode store change-event payload against its shape row schema",
        }),
    ),
  );

/** Resolve the store's scope changes stream, dying if the scope is unregistered (wiring error). @internal */
const storeChangesStream = (
  store: StoreClassWithShapes,
): Effect.Effect<
  Stream.Stream<StoreChangeEvent, StoreJournalDecodeError>,
  never,
  Storage | Scope.Scope
> => Effect.flatMap(Storage, (bridge) => Effect.orDie(bridge.changes(store.scopeKey)));

/**
 * Stream store changes. Three forms:
 *
 * - `changes(scope)` — coarse firehose of {@link StoreChangeEvent}s for a scope (string or tag).
 * - `changes(store)` — decoded rows of **every** shape on the store (discriminated union).
 * - `changes(store, select)` — decoded rows of the **one** shape the selector navigates to, e.g.
 *   `changes(store, (shapes) => shapes.sensors.temperature)`.
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
export function changes<S extends StoreClassWithShapes, Row extends Schema.Schema<unknown>>(
  store: S,
  select: (shapes: ShapeRefs<ShapesOfStore<S>>) => ShapeRef<Row>,
): Effect.Effect<
  Stream.Stream<SchemaDecoded<Row>, StoreJournalDecodeError>,
  never,
  Storage | Scope.Scope
>;
export function changes<S extends StoreClassWithShapes>(
  store: S,
): Effect.Effect<
  Stream.Stream<AllShapeRows<ShapesOfStore<S>>, StoreJournalDecodeError>,
  never,
  Storage | Scope.Scope
>;
export function changes(
  scope: string | StoreScopeTag,
): Effect.Effect<
  Stream.Stream<StoreChangeEvent, StoreJournalDecodeError>,
  StoreScopeNotRegistered,
  Storage | Scope.Scope
>;
export function changes(
  storeOrScope: string | StoreScopeTag | StoreClassWithShapes,
  select?: (shapes: ShapeRefs<StoreShapes>) => ShapeRef<Schema.Schema<unknown>>,
): Effect.Effect<
  Stream.Stream<unknown, StoreJournalDecodeError, unknown>,
  StoreScopeNotRegistered,
  Storage | Scope.Scope
> {
  if (isStoreClassWithShapes(storeOrScope)) {
    const store = storeOrScope;
    if (select !== undefined) {
      const ref = resolveShapeRef(select(makeShapeRefs(store.contract.shapes)));
      return storeChangesStream(store).pipe(
        Effect.map((stream) =>
          stream.pipe(
            Stream.filter((event) => event.method === ref.shapeKey),
            Stream.mapEffect((event) => decodeChangeRow(ref.row, event.payload)),
          ),
        ),
      );
    }
    const rowByKey = shapeRowsByKey(store.contract.shapes);
    return storeChangesStream(store).pipe(
      Effect.map((stream) =>
        stream.pipe(
          Stream.mapEffect((event) => {
            const row = rowByKey.get(event.method);
            return row === undefined
              ? Effect.die(
                  new StoreJournalDecodeError({
                    cause: `no shape row schema registered for change method "${event.method}"`,
                    detail: "Store.changes(store)",
                  }),
                )
              : decodeChangeRow(row, event.payload);
          }),
        ),
      ),
    );
  }
  const key = typeof storeOrScope === "string" ? storeOrScope : storeOrScope.key;
  return Effect.flatMap(Storage, (bridge) => bridge.changes(key));
}

/** True for a single-scope store class carrying its contract — the typed {@link changes} forms. @internal */
const isStoreClassWithShapes = (value: unknown): value is StoreClassWithShapes =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "scopeKey" in value &&
  "contract" in value &&
  isStoreContractValue(value.contract);

// ============================================================================
// Storage resolution — the ergonomic façade over the (internal) scope bridge
// ============================================================================

/**
 * Resolve the store handle for a `scope` from the storage in context (an app {@link Service}, or the
 * baked-in in-memory default). Collapses the `flatMap(bridge, (b) => b.at(scope, contract))` plumbing
 * so consumers never touch the underlying service directly.
 *
 * Fails {@link StoreScopeNotRegistered} when the provided storage doesn't carry this scope — the
 * **opt-in** path (e.g. persist only if the app wired durable storage for me). For the always-on
 * observability path, use {@link resolveOrDie}.
 *
 * @public
 */
export const resolve = <const C extends StoreContractValue>(
  scope: string | StoreScopeTag,
  contract: C,
): Effect.Effect<StoreHandleOf<C>, StoreScopeNotRegistered, Storage> =>
  Effect.flatMap(Storage, (bridge) =>
    bridge.at(typeof scope === "string" ? scope : scope.key, contract),
  );

/**
 * Like {@link resolve}, but **guarantees** a handle (`resolve` hardened with `orDie`). With the baked-in
 * default store in context (it materializes any scope on demand), this never fails — the always-on
 * observability path, where a resource's engine records unconditionally with no service-sniffing. If a
 * *custom* store is in context and lacks this scope, that's a wiring error and it dies with a clear
 * message (bake the default so it can materialize the scope).
 *
 * @public
 */
export const resolveOrDie = <const C extends StoreContractValue>(
  scope: string | StoreScopeTag,
  contract: C,
): Effect.Effect<StoreHandleOf<C>, never, Storage> =>
  resolve(scope, contract).pipe(
    Effect.catchTag("StoreScopeNotRegistered", (e) =>
      Effect.die(
        `Store.resolveOrDie: scope "${e.key}" is not registered in the provided store, and no default ` +
          `store is in context to materialize it. Provide the in-memory default (Service.layerMemory / ` +
          `the resource layer's baked default) so the scope resolves.`,
      ),
    ),
  );

/** Navigate a resolved handle to the (possibly dotted) method at `path` and apply it. @internal */
const callAt = (
  handle: unknown,
  path: string,
  args: ReadonlyArray<unknown>,
): Effect.Effect<unknown> => {
  let node: unknown = handle;
  for (const part of path.split(".")) {
    // Tree-walk idiom (as in `nestHandle` / `Resource.nestService`).
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "function") {
    return Effect.die(`Store.effects: no resolvable method at "${path}"`);
  }
  return node(...args);
};

/**
 * Stamp the honest (present-at-runtime) {@link TypeId} brand so {@link isStoreEffects} and the
 * {@link mapEffects} / {@link catchWriteErrors} constraint are backed by a real property, not a phantom.
 * Non-enumerable so it stays invisible to method access / destructuring / the {@link flattenEffects}
 * walk. @internal
 */
const stampEffectsBrand = (target: object): void => {
  Object.defineProperty(target, TypeId, {
    value: { _C: (_: never) => _ },
    enumerable: false,
  });
};

/** Flatten an effects object to a dotted-key map of its method leaves (functions). @internal */
const flattenEffects = (
  node: unknown,
  prefix: string,
  out: Record<string, unknown>,
): void => {
  if (typeof node !== "object" || node === null) {
    return;
  }
  // Tree-walk idiom (as in `nestHandle`).
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "function") {
      out[path] = value;
    } else {
      flattenEffects(value, path, out);
    }
  }
};

/**
 * Wrap a type-erased method leaf so its returned {@link Effect} is passed through `transform`. Dies if
 * the leaf is somehow not callable (a structural invariant the {@link flattenEffects} walk guarantees).
 * @internal
 */
const mapMethod =
  (
    method: unknown,
    transform: (effect: Effect.Effect<unknown, unknown, unknown>) => Effect.Effect<unknown, unknown, unknown>,
  ) =>
  (...args: ReadonlyArray<unknown>): Effect.Effect<unknown, unknown, unknown> => {
    if (typeof method !== "function") {
      return Effect.die("Store.mapEffects: effects leaf is not a method");
    }
    return transform(method(...args));
  };

/**
 * Build a PURE object of effects from a contract — the {@link HandleOf} structure (nested shape tree +
 * custom methods) where each method is `(...args) => resolveOrDie(scope, contract).flatMap((handle) =>
 * handle.<path>(...args))`. So every method carries `Storage` in its requirement (see {@link StoreEffectsOf}),
 * the error channel stays clean ({@link resolveOrDie} dies on an unregistered custom store rather than
 * surfacing `StoreScopeNotRegistered`), and there is **no** resolution / `yield*` / memo cell here — the
 * handle memo lives in the storage bridge's `.at`. No error handling ({@link catchWriteErrors} owns that).
 *
 * Write methods honestly carry {@link StoreWriteError} in their error channel (a journal/IO write
 * failure); {@link catchWriteErrors} narrows it out. Reads carry no error.
 *
 * @example
 * ```ts
 * const store = Store.effects("sensors", sensorContract);
 * yield* store.sensors.temperature.append({ celsius: 21 });   // Effect<void, StoreWriteError, Storage>
 * const rows = yield* store.sensors.temperature.read();       // Effect<ReadonlyArray<…>, never, Storage>
 * ```
 *
 * @public
 */
export const effects = <const C extends StoreContractValue>(
  scope: string | StoreScopeTag,
  contract: C,
): StoreEffectsOf<C> => {
  const method =
    (path: string) =>
    (...args: ReadonlyArray<unknown>) =>
      resolveOrDie(scope, contract).pipe(
        Effect.flatMap((handle) => callAt(handle, path, args)),
      );

  const flat: Record<string, unknown> = {};
  for (const shapeKey of shapeRowsByKey(contract.shapes).keys()) {
    flat[`${shapeKey}.append`] = method(`${shapeKey}.append`);
    flat[`${shapeKey}.read`] = method(`${shapeKey}.read`);
  }
  for (const name of Object.keys(contract.customEntries)) {
    flat[name] = method(name);
  }
  const built = nestHandle(flat);
  stampEffectsBrand(built);
  // Same generic-object structural-rebuild idiom as `makeShapeHandles` / `makeShapeRefs`: the effects
  // object is assembled by dynamic assignment (then nested), so its type is asserted once here.
  return built as StoreEffectsOf<C>;
};

/**
 * The generic transform primitive: walk **every** method on a {@link effects} object (nested shape
 * leaves + custom methods) and pass each method's returned {@link Effect} through `transform`, then
 * re-nest and re-stamp the {@link TypeId} brand. Composes with `pipe`.
 *
 * `transform` is applied uniformly; whether it changes types is expressed through the result:
 * - **Type-preserving** transforms (`withSpan` / `retry` / `timed`, whose signature is
 *   `Effect<A, E, R> → Effect<A, E, R>`) leave the type unchanged — `Out` defaults to `Effects`.
 * - **Type-changing** transforms (narrowing `E`, like {@link catchWriteErrors}) supply an explicit
 *   `Out` computed per method by a mapped type (e.g. {@link CatchWriteError}), so the change flows
 *   through each method precisely.
 *
 * @remarks
 * `Effects` is constrained to the {@link StoreEffectsVariance} brand (not `StoreEffectsOf<C>`): `C` is
 * not inferable through the opaque handle type, so that form would default `C` and widen; the brand
 * constraint rejects a bare `{}` while `C`'s covariant encoding lets a specific contract's effects
 * satisfy the wide constraint. `transform`'s `unknown`-channel signature accepts both a polymorphic
 * type-preserving transform and a concrete narrowing one without an `any`.
 *
 * @example Type-preserving — trace every store method
 * ```ts
 * const traced = Store.mapEffects(store, (effect) => Effect.withSpan(effect, "store"));
 * ```
 *
 * @public
 */
export const mapEffects = <
  Effects extends StoreEffectsVariance<StoreContractValue>,
  Out = Effects,
>(
  effects: Effects,
  transform: (
    effect: Effect.Effect<unknown, unknown, unknown>,
  ) => Effect.Effect<unknown, unknown, unknown>,
): Out => {
  const flat: Record<string, unknown> = {};
  flattenEffects(effects, "", flat);

  const mapped: Record<string, unknown> = {};
  for (const [path, method] of Object.entries(flat)) {
    mapped[path] = mapMethod(method, transform);
  }

  const built = nestHandle(mapped);
  stampEffectsBrand(built);
  // Same structural-rebuild idiom as `effects`: the mapped object is reassembled by dynamic assignment,
  // so its type is asserted once here (as `Out` — the caller-supplied per-method result, or `Effects`).
  return built as Out;
};

/** True for a {@link StoreWriteError} value (in-process `_tag` discriminator). @internal */
const isStoreWriteError = (u: unknown): u is StoreWriteError =>
  Predicate.hasProperty(u, "_tag") && u._tag === "StoreWriteError";

/**
 * The {@link catchWriteErrors} write guard: swallow a {@link StoreWriteError} **failure** (log at
 * warning level, succeed as `void`), re-raise any other failure untouched, and leave **defects** alone
 * (`Effect.catch` recovers failures only — an encode/serialization mismatch or wiring die stays a
 * defect and propagates). A no-op on reads (they never fail with `StoreWriteError`). @internal
 */
const swallowWrite = (
  effect: Effect.Effect<unknown, unknown, unknown>,
): Effect.Effect<unknown, unknown, unknown> =>
  Effect.catch(effect, (error) =>
    isStoreWriteError(error)
      ? Effect.logWarning("store write failed", error)
      : Effect.fail(error),
  );

/**
 * Narrow {@link StoreWriteError} out of the error channel of a {@link effects} object's **write**
 * methods — a fire-and-forget append that fails a journal/IO write is **logged and swallowed**
 * (succeeds as `void`). One-liner over {@link mapEffects}. Composes with `pipe`:
 * `pipe(Store.effects(scope, contract), Store.catchWriteErrors)`.
 *
 * Scope of the guard, precisely:
 * - **Write failures are swallowed** — the `StoreWriteError` is caught, logged, and the effect
 *   completes successfully; `StoreWriteError` is removed from `E` (see {@link CatchWriteError}).
 * - **Defects are NOT swallowed** — an encode/serialization mismatch (a bug: the value does not fit the
 *   declared shape, dies in the append path) and a wiring die (no store in context) are **defects**,
 *   not failures, so they propagate untouched.
 * - **Reads and every other error are left exactly as-is** — `Exclude<E, StoreWriteError>` is a no-op
 *   where `StoreWriteError` is absent.
 *
 * @public
 */
export const catchWriteErrors = <Effects extends StoreEffectsVariance<StoreContractValue>>(
  effects: Effects,
): CatchWriteError<Effects> => mapEffects<Effects, CatchWriteError<Effects>>(effects, swallowWrite);

/**
 * Provide a {@link Context.Context} to **every method** of an {@link effects} object — the one-liner
 * that replaces a repetitive per-method `Effect.provideContext(...)` wrapping. One-liner over
 * {@link mapEffects}, exactly parallel to {@link catchWriteErrors}; the result **subtracts** the
 * provided context `Ctx` from each method's requirement (see {@link StoreProvidedContext}) — `R` →
 * `Exclude<R, Ctx>` — so an effects object whose only requirement is {@link Storage} becomes the
 * `Storage`-free shape a downstream consumer expects, while a method needing more than `Ctx` provides
 * keeps a residual requirement (caught at the assignment) rather than a false `never`. Providing the
 * context to a method that carries no matching `R` is a harmless no-op, so it applies uniformly.
 *
 * ```ts
 * const storageContext = yield* Effect.context<Store.Storage>();
 * const store = Store.provideContext(storeEffects, storageContext); // methods become Effect<void>
 * ```
 *
 * @public
 */
export const provideContext = <
  Effects extends StoreEffectsVariance<StoreContractValue>,
  Ctx,
>(
  effects: Effects,
  context: Context.Context<Ctx>,
): StoreProvidedContext<Effects, Ctx> =>
  mapEffects<Effects, StoreProvidedContext<Effects, Ctx>>(effects, (effect) =>
    Effect.provideContext(effect, context),
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
 * Declare an app store — **class extends** with {@link layerMemory} / {@link layer}.
 *
 * Three input shapes:
 *
 * - **Single store** — bare registration: `QueueResource.store(Mail)` → `yield* MailStore`
 * - **Tag-keyed multi** — array: `[QueueResource.store(Mail), …]` → `yield* AppStore.at(Mail)`
 * - **Custom-keyed** — object: `{ mail: QueueResource.store(Mail), … }` → `yield* AppStore.at("mail")`
 *
 * `layerMemory` uses in-memory refs. `layer({ filename })` persists to SQLite (`filename` required).
 *
 * @example Single store
 * ```ts
 * class MailStore extends Store.Service<MailStore>("@app/MailStore")(
 *   QueueResource.store(Mail),
 * ) {}
 *
 * const handle = yield* MailStore;
 * Effect.provide(program, MailStore.layer({ filename: "data.sqlite" }));
 * ```
 *
 * @example Multi store
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
export const Service = <Self>(id: string) => {
  const define = defineStoreTag<Self, typeof id extends string ? typeof id : never>(id);
  return <const Args extends ReadonlyArray<unknown>>(...args: Args) => {
    type Input = Args extends readonly [infer Only] ? Only : Args;
    const input = (args.length === 1 ? args[0]! : args) as Input;
    const storeClass = define(input);
    return attachStoreLayers<Self, string, typeof storeClass>(storeClass) as IsSingleStoreInput<Input> extends true
      ? SingleStoreServiceClass<Self, string, ContractForSingleInput<Input>>
      : StoreServiceClass<Self, string, RegsOfStoreInput<Input>>;
  };
};

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

/** Standalone single-scope store class from {@link scoped}. @public */
export type Standalone<
  Self,
  Id extends string,
  K extends string,
  C extends StoreContractValue,
> = StandaloneStore<Self, Id, K, C>;

/**
 * Standalone store for one scope — class with `layerMemory` / `layer({ filename? })` like
 * {@link Service}, but single-scope.
 *
 * @example
 * ```ts
 * const ThermoStore = Store.scoped("solo", thermometerContract);
 * Effect.provide(program, ThermoStore.layer({ filename: "data.sqlite" }));
 * ```
 *
 * @public
 */
export const scoped = <
  const ScopeKey extends string | StoreScopeTag,
  const C extends StoreContractValue,
>(
  scope: ScopeKey,
  contract: C,
): StandaloneStore<
  { readonly _tag: ScopeKeyOf<ScopeKey> },
  `@nikscripts/effect-pm/Store/scope/${ScopeKeyOf<ScopeKey>}`,
  ScopeKeyOf<ScopeKey>,
  C,
  ScopeKey extends StoreScopeTag ? ScopeKey : undefined
> => {
  const standaloneClass = defineStandaloneStore(scope, contract);
  const registration = buildStandaloneRegistration(scope, contract);
  const layerMemory = buildStandaloneMemoryLayer(standaloneClass, registration);
  const layer = (options: StoreLayerOptions) =>
    buildStandaloneSqliteLayer(standaloneClass, registration, options.filename);
  return Object.assign(standaloneClass, {
    layerMemory,
    layer,
  });
};

/**
 * Attach a public store spec to a resource tag (pipe combinator).
 *
 * Adds `yield* Tag.store` resolved through the {@link Storage} bridge.
 *
 * @example
 * ```ts
 * class Thermometer extends Resource.Tag<Thermometer>()(key, contract).pipe(
 *   Resource.withStore(thermometerStoreSpec),
 * ) {}
 * ```
 *
 * @public
 */
export const withStore = <const C extends StoreContractValue>(
  contract: C,
): (<T extends StoreScopeTag>(tag: T) => T & {
  readonly store: Effect.Effect<
    StoreHandleFromContract<C>,
    StoreScopeNotRegistered,
    Storage
  >;
}) =>
  <T extends StoreScopeTag>(tag: T) =>
    Object.assign(tag, {
      store: resolve(tag.key, contract),
    }) as T & {
      readonly store: Effect.Effect<
        StoreHandleFromContract<C>,
        StoreScopeNotRegistered,
        Storage
      >;
    };

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
  export { Storage };

  /** @public */
  export type { StorageApi };

  /** @public */
  export { layerDefaultMemory };

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
  > = StandaloneStore<Self, Id, K, C>;

  /** Scope keys (tuple registrations) or accessor keys (object registrations) on a store class. @public */
  export type KeysOf<T> = T extends { readonly [storeRegsSym]: infer Regs }
    ? Regs extends ReadonlyArray<{ readonly scopeKey: infer K extends string }>
      ? K
      : Regs extends Record<string, { readonly scopeKey: infer K extends string }>
        ? K
        : never
    : never;
}
