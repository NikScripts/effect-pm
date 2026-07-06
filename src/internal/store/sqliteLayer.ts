/**
 * {@link Store.Service} layers — {@link EventJournal} memory + {@link SqlEventJournal} SQL.
 *
 * @module internal/store/sqliteLayer
 * @internal
 */

import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Context, Effect, Layer, Scope } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import * as EventJournal from "effect/unstable/eventlog/EventJournal";
import * as SqlEventJournal from "effect/unstable/eventlog/SqlEventJournal";
import { StoreScopeBridgeTag, type StoreScopeBridge } from "./bridge";
import type { StoreContractValue } from "./contractDef";
import type { StoreBundle } from "./defineStore";
import { StoreScopeNotRegistered, StoreSqliteConnectionError } from "./errors";
import {
  buildScopeStateMap,
  type ScopeState,
} from "./memoryScope";
import type { NormalizedStoreRegistration } from "./registrationNormalize";
import { buildScopeBridge } from "./scopeBridge";
import type { StoreHandleFromContract } from "./spec";

/** @internal */
export const buildBundle = <Regs extends ReadonlyArray<NormalizedStoreRegistration>>(
  registrations: Regs,
  acquire: StoreScopeBridge["at"],
): Effect.Effect<StoreBundle<Regs>, StoreScopeNotRegistered> =>
  Effect.gen(function* () {
    const bundle: Record<string, unknown> = {};
    for (const registration of registrations) {
      bundle[registration.accessor] = yield* acquire(
        registration.scopeKey,
        registration.spec,
        registration.contract,
      );
    }
    return bundle as StoreBundle<Regs>;
  });

/** @internal */
const sqliteConnectionError = (cause: SqlError | unknown): StoreSqliteConnectionError =>
  new StoreSqliteConnectionError({ cause });

/** @internal */
const mapSqliteBuildError = (
  error: SqlError | StoreSqliteConnectionError,
): StoreSqliteConnectionError =>
  error instanceof StoreSqliteConnectionError ? error : sqliteConnectionError(error);

/** @internal */
const layerFromBuiltBridge = <
  Self,
  Id extends string,
  Regs,
>(
  tag: Context.ServiceClass<Self, Id, StoreBundle<Regs>>,
  bundle: StoreBundle<Regs>,
  bridge: StoreScopeBridge,
): Layer.Layer<Self | StoreScopeBridgeTag> =>
  Layer.mergeAll(
    Layer.succeed(tag, bundle as unknown as StoreBundle<Regs>),
    Layer.succeed(StoreScopeBridgeTag, bridge),
  );

/** @internal */
export const layerForSingleRegistration = <
  Self,
  Id extends string,
  C extends StoreContractValue,
>(
  tag: Context.ServiceClass<Self, Id, StoreHandleFromContract<C>>,
  registration: NormalizedStoreRegistration,
  scopes: Map<string, ScopeState>,
): Layer.Layer<Self | StoreScopeBridgeTag, never, EventJournal.EventJournal> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const journal = yield* EventJournal.EventJournal;
      const bridge = buildScopeBridge(scopes, journal);
      const handle = yield* bridge
        .at(registration.scopeKey, registration.spec, registration.contract)
        .pipe(Effect.orDie);
      return Layer.mergeAll(
        Layer.succeed(tag, handle as unknown as StoreHandleFromContract<C>),
        Layer.succeed(StoreScopeBridgeTag, bridge),
      );
    }),
  );

/** @internal */
export const buildStandaloneMemoryLayer = <
  Self,
  Id extends string,
  C extends StoreContractValue,
>(
  tag: Context.ServiceClass<Self, Id, StoreHandleFromContract<C>>,
  registration: NormalizedStoreRegistration,
): Layer.Layer<Self | StoreScopeBridgeTag> =>
  layerForSingleRegistration(tag, registration, buildScopeStateMap([registration])).pipe(
    Layer.provide(EventJournal.layerMemory),
  );

/** @internal */
export const buildStandaloneSqliteLayer = <
  Self,
  Id extends string,
  C extends StoreContractValue,
>(
  tag: Context.ServiceClass<Self, Id, StoreHandleFromContract<C>>,
  registration: NormalizedStoreRegistration,
  filename: string,
): Layer.Layer<Self | StoreScopeBridgeTag, StoreSqliteConnectionError, Scope.Scope> => {
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
        .at(registration.scopeKey, registration.spec, registration.contract)
        .pipe(Effect.orDie);
      return Layer.mergeAll(
        Layer.succeed(tag, handle as unknown as StoreHandleFromContract<C>),
        Layer.succeed(StoreScopeBridgeTag, bridge),
      ).pipe(Layer.provide(Layer.succeedContext(context)));
    }).pipe(Effect.mapError(mapSqliteBuildError)),
  );
};

/** @internal */
export const buildStandaloneLayer = <
  Self,
  Id extends string,
  C extends StoreContractValue,
>(
  tag: Context.ServiceClass<Self, Id, StoreHandleFromContract<C>>,
  registration: NormalizedStoreRegistration,
  options?: { readonly filename?: string },
): Layer.Layer<Self | StoreScopeBridgeTag, StoreSqliteConnectionError, Scope.Scope> =>
  options?.filename !== undefined
    ? buildStandaloneSqliteLayer(tag, registration, options.filename)
    : (buildStandaloneMemoryLayer(tag, registration) as Layer.Layer<
        Self | StoreScopeBridgeTag,
        StoreSqliteConnectionError,
        Scope.Scope
      >);

/** @internal */
export const layerFromScopeState = <
  Self,
  Id extends string,
  Regs,
>(
  tag: Context.ServiceClass<Self, Id, StoreBundle<Regs>>,
  registrations: ReadonlyArray<NormalizedStoreRegistration>,
  scopes: Map<string, ScopeState>,
): Layer.Layer<Self | StoreScopeBridgeTag, never, EventJournal.EventJournal> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const journal = yield* EventJournal.EventJournal;
      const bridge = buildScopeBridge(scopes, journal);
      const bundle = yield* buildBundle(registrations, bridge.at).pipe(Effect.orDie);
      return layerFromBuiltBridge(tag, bundle as StoreBundle<Regs>, bridge);
    }),
  );

/** @internal */
export const buildMemoryLayerForAggregate = <
  Self,
  Id extends string,
  Regs,
>(
  tag: Context.ServiceClass<Self, Id, StoreBundle<Regs>>,
  registrations: ReadonlyArray<NormalizedStoreRegistration>,
): Layer.Layer<Self | StoreScopeBridgeTag> => {
  const scopes = buildScopeStateMap(registrations);
  return layerFromScopeState(tag, registrations, scopes).pipe(
    Layer.provide(EventJournal.layerMemory),
  );
};

/** @internal */
export const buildSqliteLayerForAggregate = <
  Self,
  Id extends string,
  Regs,
>(
  tag: Context.ServiceClass<Self, Id, StoreBundle<Regs>>,
  registrations: ReadonlyArray<NormalizedStoreRegistration>,
  filename: string,
): Layer.Layer<Self | StoreScopeBridgeTag, StoreSqliteConnectionError, Scope.Scope> => {
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
export const buildMemoryScopeState = buildScopeStateMap;
