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
  StoreJournalDecodeError,
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
export type { MergedCustom, StoreContractValue, StoreMethodsFn, StoreShapeDef, StoreShapeInput, StoreShapes } from "./internal/store/contract";

export { StoreDuplicateScopeKey, StoreScopeNotRegistered, StoreChangeEvent } from "./internal/store/errors";

// ============================================================================
// Storage service tag + layers
// ============================================================================
//
// The `Storage` service is co-located with its layer builders here (Effect's
// service-with-layers pattern, like `EventJournal` holds the tag + `layerMemory`). Internal
// store modules stay one-directional: they consume the pure `StorageApi` type from
// `./internal/store/bridge` and never import this tag value.

/**
 * The storage service every store handle resolves through — an app {@link Service} layer, or the
 * baked-in in-memory default. Carries the (internal) {@link StorageApi} scope bridge.
 *
 * @internal
 */
export class Storage extends Context.Service<Storage, StorageApi>()(
  "@nikscripts/effect-pm/Store/Storage",
) {}

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
 * The baked-in default store: provides {@link Storage} from a process-local in-memory journal so
 * `Tag.store` / `Resource.store` resolve with **no app {@link Service} provided**. An app store
 * provides the same tag and overrides this by plain layer composition.
 *
 * @internal
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
 * The object of effects produced by {@link effects}: the {@link HandleOf} structure (nested shape tree +
 * custom methods) with {@link Storage} added to every method's requirement channel.
 *
 * @public
 */
export type StoreEffectsOf<C extends StoreContractValue> = AddStorageReq<StoreHandleFromContract<C>>;

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
 * Build a PURE object of effects from a contract — the {@link HandleOf} structure (nested shape tree +
 * custom methods) where each method is `(...args) => withDefault(scope, contract).flatMap((handle) =>
 * handle.<path>(...args))`. So every method carries `Storage` in its requirement (see {@link StoreEffectsOf}),
 * the error channel stays clean ({@link withDefault} dies on an unregistered custom store rather than
 * surfacing `StoreScopeNotRegistered`), and there is **no** resolution / `yield*` / memo cell here — the
 * handle memo lives in the storage bridge's `.at`. No error handling (a future `withGuard` owns that).
 *
 * @example
 * ```ts
 * const store = Store.effects("sensors", sensorContract);
 * yield* store.sensors.temperature.append({ celsius: 21 });   // Effect<void, never, Storage>
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
      withDefault(scope, contract).pipe(
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
  // Same generic-object structural-rebuild idiom as `makeShapeHandles` / `makeShapeRefs`: the effects
  // object is assembled by dynamic assignment (then nested), so its type is asserted once here.
  return nestHandle(flat) as StoreEffectsOf<C>;
};


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
