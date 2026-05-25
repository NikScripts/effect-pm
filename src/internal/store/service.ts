/**
 * Internal factory powering {@link ProcessStoreBuilder.Service}.
 *
 * @module ProcessStoreService
 * @internal
 */

import { Cause, Clock, Context, Effect, Layer, Option } from "effect";
import type { ProcessStoreWriteError } from "../../ProcessStoreEvent";
import { RuntimeStorage } from "../../RuntimeStorage";
import { makeProcessStoreSpine, makeRunId, type ProcessStoreSpine } from "./spine";

const RECORD_TAG = "ProcessStore/record" as const;
const READ_TAG = "ProcessStore/read" as const;

type PersistEffect = Effect.Effect<void, ProcessStoreWriteError>;

type EmitEffect = Effect.Effect<void>;

type EmitMethod<F> = F extends (...args: infer A) => unknown
  ? (...args: A) => EmitEffect
  : never;

type ReadMethod<F> = F extends (...args: infer A) => infer R
  ? (...args: A) => R
  : never;

/** @internal */
export interface ProcessStoreRecordSection<EmitApi> {
  readonly _tag: typeof RECORD_TAG;
  readonly fn: (s: ProcessStoreSpine) => EmitApi;
  readonly emitKeys: ReadonlyArray<keyof EmitApi & string>;
}

/** @internal */
export interface ProcessStoreReadSection<ReadApi> {
  readonly _tag: typeof READ_TAG;
  readonly fn: (s: ProcessStoreSpine) => ReadApi;
}

const stubSpine = (): ProcessStoreSpine => ({
  append: () => Effect.void,
  appendBatch: () => Effect.void,
  events: () => Effect.succeed([]),
  records: () => Effect.succeed([]),
});

/** @internal */
export const processStoreRecord = <EmitApi extends Record<string, unknown>>(
  fn: (s: ProcessStoreSpine) => EmitApi,
): ProcessStoreRecordSection<EmitApi> => {
  const probe = fn(stubSpine());
  const emitKeys = Object.keys(probe) as Array<keyof EmitApi & string>;
  return {
    _tag: RECORD_TAG,
    fn,
    emitKeys,
  };
};

/** @internal */
export const processStoreRead = <ReadApi>(
  fn: (s: ProcessStoreSpine) => ReadApi,
): ProcessStoreReadSection<ReadApi> => ({
  _tag: READ_TAG,
  fn,
});

const buildStore = Effect.gen(function* () {
  const storage = yield* RuntimeStorage;
  const now = yield* Clock.currentTimeMillis;
  return makeProcessStoreSpine(storage, makeRunId(now));
});

/** @internal */
export type OptionalEmitStatics<EmitApi> = {
  readonly [K in keyof EmitApi & string]: EmitMethod<EmitApi[K]>;
};

/** @internal */
export type OptionalReadStatics<ReadApi> = {
  readonly [K in keyof ReadApi & string]: ReadMethod<ReadApi[K]>;
};

/** @internal */
export type ProcessStoreServiceClass<
  Self,
  Id extends string,
  EmitApi,
  ReadApi,
> = Context.ServiceClass<Self, Id, EmitApi & ReadApi> & {
  readonly make: Effect.Effect<EmitApi & ReadApi, never, RuntimeStorage>;
  readonly layerRuntimeStorage: Layer.Layer<Self, never, RuntimeStorage>;
  readonly layer: Layer.Layer<Self, never, never>;
  readonly Type: EmitApi & ReadApi;
  readonly EmitType: EmitApi;
} & OptionalEmitStatics<EmitApi> &
  OptionalReadStatics<ReadApi>;

/** @internal */
export type ProcessStoreServiceShape<T> = T extends { readonly Type: infer S }
  ? S
  : never;

/** @internal */
export type ProcessStoreServiceEmitShape<T> = T extends {
  readonly EmitType: infer E;
}
  ? E
  : never;

const wrapEmitForFacet =
  (id: string, method: string) =>
  (effect: PersistEffect): EmitEffect =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(`${id} write failed for ${method}`).pipe(
          Effect.annotateLogs("cause", Cause.pretty(cause)),
        ),
      ),
      Effect.asVoid,
    );

const mergeServiceShape = <EmitApi extends Record<string, unknown>, ReadApi>(
  recordPart: EmitApi,
  readPart: ReadApi,
): EmitApi & ReadApi => ({ ...recordPart, ...readPart });

const invokePersistMethod = (
  api: unknown,
  methodName: string,
  args: ReadonlyArray<unknown>,
): PersistEffect => {
  if (typeof api !== "object" || api === null) {
    return Effect.die(`ProcessStore API is not an object`);
  }
  const method = (api as Record<string, unknown>)[methodName];
  if (typeof method !== "function") {
    return Effect.die(`ProcessStore method missing: ${methodName}`);
  }
  return Reflect.apply(method, api, args) as PersistEffect;
};

const buildEmitStatics = <
  Self,
  Id extends string,
  EmitApi extends Record<string, unknown>,
  ReadApi,
>(
  id: Id,
  emitKeys: ReadonlyArray<keyof EmitApi & string>,
  Base: Context.ServiceClass<Self, Id, EmitApi & ReadApi>,
): OptionalEmitStatics<EmitApi> => {
  const out: { [K in keyof EmitApi & string]?: EmitMethod<EmitApi[K]> } = {};
  for (const emitKey of emitKeys) {
    const wrap = wrapEmitForFacet(id, emitKey);
    out[emitKey] = ((...args: ReadonlyArray<unknown>) =>
      wrap(
        Effect.serviceOption(Base).pipe(
          Effect.flatMap(
            Option.match({
              onNone: (): PersistEffect => Effect.void,
              onSome: (api): PersistEffect => invokePersistMethod(api, emitKey, args),
            }),
          ),
        ),
      )) as EmitMethod<EmitApi[typeof emitKey]>;
  }
  return out as OptionalEmitStatics<EmitApi>;
};

const buildReadStatics = <
  Self,
  Id extends string,
  EmitApi,
  ReadApi extends Record<string, unknown>,
>(
  readKeys: ReadonlyArray<keyof ReadApi & string>,
  stubReadApi: ReadApi,
  Base: Context.ServiceClass<Self, Id, EmitApi & ReadApi>,
): OptionalReadStatics<ReadApi> => {
  const out: { [K in keyof ReadApi & string]?: ReadMethod<ReadApi[K]> } = {};
  for (const readKey of readKeys) {
    out[readKey] = ((...args: ReadonlyArray<unknown>) =>
      Effect.serviceOption(Base).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => invokePersistMethod(stubReadApi, readKey, args),
            onSome: (api) => invokePersistMethod(api, readKey, args),
          }),
        ),
      )) as ReadMethod<ReadApi[typeof readKey]>;
  }
  return out as OptionalReadStatics<ReadApi>;
};

/** Type-only phantoms for `typeof Facet.Type` / `typeof Facet.EmitType` (never read at runtime). */
const facetTypePhantoms = <EmitApi, ReadApi>(): {
  readonly Type: EmitApi & ReadApi;
  readonly EmitType: EmitApi;
} => ({
  Type: undefined as EmitApi & ReadApi,
  EmitType: undefined as EmitApi,
});

const assembleFacetClass = <
  Self,
  Id extends string,
  EmitApi extends Record<string, unknown>,
  ReadApi extends Record<string, unknown>,
>(
  Base: Context.ServiceClass<Self, Id, EmitApi & ReadApi>,
  layerRuntimeStorage: Layer.Layer<Self, never, RuntimeStorage>,
  layer: Layer.Layer<Self, never, never>,
  emitStatics: OptionalEmitStatics<EmitApi>,
  readStatics: OptionalReadStatics<ReadApi>,
): ProcessStoreServiceClass<Self, Id, EmitApi, ReadApi> =>
  Object.assign(
    Base,
    { layerRuntimeStorage, layer },
    emitStatics,
    readStatics,
    facetTypePhantoms<EmitApi, ReadApi>(),
  ) as ProcessStoreServiceClass<Self, Id, EmitApi, ReadApi>;

/** @internal */
export const defineProcessStoreService = <Self>() =>
  <const Id extends string, EmitApi extends Record<string, unknown>, ReadApi extends Record<string, unknown>>(
    id: Id,
    recordSection: ProcessStoreRecordSection<EmitApi>,
    readSection: ProcessStoreReadSection<ReadApi>,
  ): ProcessStoreServiceClass<Self, Id, EmitApi, ReadApi> => {
    const make: Effect.Effect<EmitApi & ReadApi, never, RuntimeStorage> = Effect.gen(
      function* () {
        const s = yield* buildStore;
        return mergeServiceShape(recordSection.fn(s), readSection.fn(s));
      },
    );

    const Base = Context.Service<Self, EmitApi & ReadApi>()(id, { make });

    const stubReadApi = readSection.fn(stubSpine());
    const readKeys = Object.keys(stubReadApi) as Array<keyof ReadApi & string>;

    const emitStatics = buildEmitStatics(id, recordSection.emitKeys, Base);
    const readStatics = buildReadStatics(readKeys, stubReadApi, Base);

    const layerRuntimeStorage = Layer.effect(Base, make);
    const layer = Layer.provide(layerRuntimeStorage, RuntimeStorage.layer);

    return assembleFacetClass(Base, layerRuntimeStorage, layer, emitStatics, readStatics);
  };
