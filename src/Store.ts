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
 * ## Engine authoring
 *
 * Toolkit engines (Process, Queue, RunResource, custom resources) resolve store handles through
 * {@link Storage} — a **defaulted service** always in context when {@link layerDefaultMemory} is
 * merged (or when an app {@link Service} overrides it). Declare it as a dependency; never
 * `Effect.serviceOption`.
 *
 * - {@link withDefault} — always-on observability (`record` unconditionally).
 * - {@link withStorage} — opt-in when the app registered the scope on a custom store.
 * - `yield* Storage` then `bridge.at(scopeKey, contract)` — low-level; prefer the façades.
 *
 * Bake the default into a resource layer:
 *
 * ```ts
 * myLayer.pipe(Layer.provideMerge(Store.layerDefaultMemory))
 * ```
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

import { Context, Effect, Layer, Schema, Scope, Stream } from "effect";
import * as EventJournal from "effect/unstable/eventlog/EventJournal";
import * as SqlEventJournal from "effect/unstable/eventlog/SqlEventJournal";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import {
  buildStandaloneRegistration,
  defineStandaloneStore,
  defineStoreTag,
  storeDefaultLogLevelSym,
  storeRegsSym,
  type StandaloneStoreClass,
  type StoreBundle,
  type StoreTagClass,
} from "./internal/store/defineStore";
import type { StorageApi } from "./internal/store/bridge";
import { buildDefaultScopeBridge, buildScopeBridge } from "./internal/store/scopeBridge";
import { buildScopeStateMap, type ScopeState } from "./internal/store/memoryScope";
import { buildBundle, mapSqliteBuildError } from "./internal/store/sqliteLayer";
import type { NormalizedStoreRegistration } from "./internal/store/registrationNormalize";
import {
  StoreScopeNotRegistered,
  StoreChangeEvent,
  type StoreJournalDecodeError,
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
  type StoreHandleOf,
} from "./internal/store/spec";
import type { StoreLayerOptions, StoreLogLevel } from "./internal/store/types";

export type { StoreLayerOptions, StoreLogLevel } from "./internal/store/types";
export type { StoreHandleFromContract } from "./internal/store/spec";
export type { MergedCustom, StoreContractValue, StoreMethodsFn, StoreShapeDef, StoreShapeInput, StoreShapes } from "./internal/store/contract";

export { StoreDuplicateScopeKey, StoreScopeNotRegistered, StoreChangeEvent } from "./internal/store/errors";

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
 * const store = yield* Store.withDefault(tag.key, builtInMyStoreContract(tag));
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
  readonly layerMemory: Layer.Layer<Self | Storage>;
  readonly layer: (
    options?: StoreLayerOptions,
  ) => Layer.Layer<Self | Storage, StoreSqliteConnectionError, Scope.Scope>;
};

/** Aggregate store class with attached {@link Storage} layers. @internal */
export type StoreServiceClass<
  Self = unknown,
  Id extends string = string,
  Regs = ReadonlyArray<NormalizedStoreRegistration>,
> = StoreTagClass<Self, Id, Regs> & StoreLayers<Self>;

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
): Layer.Layer<Self | Storage> =>
  Layer.mergeAll(
    Layer.succeed(tag, bundle as unknown as StoreBundle<Regs>),
    Layer.succeed(Storage, bridge),
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
      const bridge = buildScopeBridge(scopes, journal);
      const handle = yield* bridge
        .at(registration.scopeKey, registration.contract ?? registration.spec)
        .pipe(Effect.orDie);
      return Layer.mergeAll(
        Layer.succeed(tag, handle as unknown as StoreHandleFromContract<C>),
        Layer.succeed(Storage, bridge),
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
): Layer.Layer<Self | Storage> =>
  layerForSingleRegistration(tag, registration, buildScopeStateMap([registration])).pipe(
    Layer.provide(EventJournal.layerMemory),
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
): Layer.Layer<Self | Storage, StoreSqliteConnectionError, Scope.Scope> => {
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
      return Layer.mergeAll(
        Layer.succeed(tag, handle as unknown as StoreHandleFromContract<C>),
        Layer.succeed(Storage, bridge),
      ).pipe(Layer.provide(Layer.succeedContext(context)));
    }).pipe(Effect.mapError(mapSqliteBuildError)),
  );
};

/** @internal */
const buildStandaloneLayer = <
  Self,
  Id extends string,
  C extends StoreContractValue,
>(
  tag: Context.ServiceClass<Self, Id, StoreHandleFromContract<C>>,
  registration: NormalizedStoreRegistration,
  options?: { readonly filename?: string },
): Layer.Layer<Self | Storage, StoreSqliteConnectionError, Scope.Scope> =>
  options?.filename !== undefined
    ? buildStandaloneSqliteLayer(tag, registration, options.filename)
    : (buildStandaloneMemoryLayer(tag, registration) as Layer.Layer<
        Self | Storage,
        StoreSqliteConnectionError,
        Scope.Scope
      >);

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
      const bridge = buildScopeBridge(scopes, journal);
      const bundle = yield* buildBundle(registrations, bridge.at).pipe(Effect.orDie);
      return layerFromBuiltBridge(tag, bundle as StoreBundle<Regs>, bridge);
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
): Layer.Layer<Self | Storage> => {
  const scopes = buildScopeStateMap(registrations);
  return layerFromScopeState(tag, registrations, scopes).pipe(
    Layer.provide(EventJournal.layerMemory),
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
): Layer.Layer<Self | Storage, StoreSqliteConnectionError, Scope.Scope> => {
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
      return layerFromBuiltBridge(tag, bundle as StoreBundle<Regs>, bridge).pipe(
        Layer.provide(Layer.succeedContext(context)),
      );
    }).pipe(Effect.mapError(mapSqliteBuildError)),
  );
};

/** @internal */
const buildLayerForAggregate = <
  Self,
  Id extends string,
  Regs,
>(
  tag: Context.ServiceClass<Self, Id, StoreBundle<Regs>>,
  registrations: ReadonlyArray<NormalizedStoreRegistration>,
  options?: StoreLayerOptions,
): Layer.Layer<Self | Storage, StoreSqliteConnectionError, Scope.Scope> =>
  options?.filename !== undefined
    ? buildSqliteLayerForAggregate(tag, registrations, options.filename)
    : (buildMemoryLayerForAggregate(tag, registrations) as Layer.Layer<
        Self | Storage,
        StoreSqliteConnectionError,
        Scope.Scope
      >);

/** Attach `layerMemory` / `layer` to a registration-only aggregate class. @internal */
const attachAggregateLayers = <
  Self,
  Id extends string,
  Regs,
>(
  aggregate: StoreTagClass<Self, Id, Regs>,
): StoreServiceClass<Self, Id, Regs> => {
  const registrations = aggregate[storeRegsSym] as ReadonlyArray<NormalizedStoreRegistration>;
  const layerMemory = buildMemoryLayerForAggregate(aggregate, registrations);
  const layer = (options?: StoreLayerOptions) =>
    buildLayerForAggregate(aggregate, registrations, options);
  return Object.assign(aggregate, {
    layerMemory,
    layer,
  }) as StoreServiceClass<Self, Id, Regs>;
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
    layer: (options?: StoreLayerOptions) =>
      buildLayerForAggregate(storeClass, registrations, {
        ...options,
        logLevel: options?.logLevel ?? level,
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
  Storage | Scope.Scope
> =>
  Effect.flatMap(Storage, (bridge) =>
    bridge.changes(typeof scope === "string" ? scope : scope.key),
  );

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
 * observability path, use {@link withDefault}.
 *
 * @public
 */
export const withStorage = <const C extends StoreContractValue>(
  scope: string | StoreScopeTag,
  contract: C,
): Effect.Effect<StoreHandleOf<C>, StoreScopeNotRegistered, Storage> =>
  Effect.flatMap(Storage, (bridge) =>
    bridge.at(typeof scope === "string" ? scope : scope.key, contract),
  );

/**
 * Like {@link withStorage}, but **guarantees** a handle. With the baked-in default store in context
 * (it materializes any scope on demand), this never fails — the always-on observability path, where a
 * resource's engine records unconditionally with no service-sniffing. If a *custom* store is in
 * context and lacks this scope, that's a wiring error and it dies with a clear message (bake the
 * default so it can materialize the scope).
 *
 * @public
 */
export const withDefault = <const C extends StoreContractValue>(
  scope: string | StoreScopeTag,
  contract: C,
): Effect.Effect<StoreHandleOf<C>, never, Storage> =>
  withStorage(scope, contract).pipe(
    Effect.catchTag("StoreScopeNotRegistered", (e) =>
      Effect.die(
        `Store.withDefault: scope "${e.key}" is not registered in the provided store, and no default ` +
          `store is in context to materialize it. Provide the in-memory default (Service.layerMemory / ` +
          `the resource layer's baked default) so the scope resolves.`,
      ),
    ),
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
export const Service = <Self>(id: string) => {
  const define = defineStoreTag<Self, typeof id extends string ? typeof id : never>(id);
  return <const Args extends ReadonlyArray<unknown>>(...args: Args) =>
    attachAggregateLayers(define(...args));
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

/** Standalone single-scope store class from {@link store}. @public */
export type Standalone<
  Self,
  Id extends string,
  K extends string,
  C extends StoreContractValue,
> = StandaloneStore<Self, Id, K, C>;

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
  ): StandaloneStore<
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
      Storage
    >;
  };
} = ((scopeOrContract: string | StoreScopeTag | StoreContractValue, maybeContract?: StoreContractValue) => {
  if (maybeContract !== undefined) {
    const scope = scopeOrContract as string | StoreScopeTag;
    const standaloneClass = defineStandaloneStore(scope, maybeContract);
    const registration = buildStandaloneRegistration(scope, maybeContract);
    const layerMemory = buildStandaloneMemoryLayer(standaloneClass, registration);
    const layer = (options?: StoreLayerOptions) =>
      buildStandaloneLayer(standaloneClass, registration, options);
    return Object.assign(standaloneClass, {
      layerMemory,
      layer,
    });
  }
  const contract = scopeOrContract as StoreContractValue;
  return <T extends StoreScopeTag>(tag: T) =>
    Object.assign(tag, {
      store: withStorage(tag.key, contract),
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
