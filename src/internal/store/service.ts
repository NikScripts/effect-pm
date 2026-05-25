/**
 * Internal factory powering {@link ProcessStore.Service}.
 *
 * @module ProcessStoreFacetService
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

/**
 * Type-only hooks on the facet constructor; never read at runtime.
 *
 * @internal
 */
export type ProcessStoreFacetBrand<EmitApi, ReadApi> = {
  readonly __processStoreEmit?: EmitApi;
  readonly __processStoreRead?: ReadApi;
};

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
export type ProcessStoreFacetClass<
  Self,
  Id extends string,
  EmitApi,
  ReadApi,
> = Context.ServiceClass<Self, Id, EmitApi & ReadApi> & {
  readonly make: Effect.Effect<EmitApi & ReadApi, never, RuntimeStorage>;
  readonly layerRuntimeStorage: Layer.Layer<Self, never, RuntimeStorage>;
  readonly layer: Layer.Layer<Self, never, never>;
} & ProcessStoreFacetBrand<EmitApi, ReadApi> &
  OptionalEmitStatics<EmitApi>;

/** @internal */
export type ProcessStoreFacetShape<T> = T extends ProcessStoreFacetBrand<
  infer EmitApi,
  infer ReadApi
>
  ? EmitApi & ReadApi
  : never;

/** @internal */
export type ProcessStoreFacetEmitShape<T> = T extends ProcessStoreFacetBrand<
  infer EmitApi,
  infer _ReadApi
>
  ? EmitApi
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

const mergeServiceShape = <EmitApi extends Record<string, unknown>, ReadApi extends Record<string, unknown>>(
  recordPart: EmitApi,
  readPart: ReadApi,
): EmitApi & ReadApi =>
  ({ ...recordPart, ...readPart }) satisfies EmitApi & ReadApi;

const callPersistMethod = <Api extends Record<string, unknown>>(
  api: Api,
  methodName: keyof Api & string,
  args: ReadonlyArray<unknown>,
): PersistEffect => {
  const method = api[methodName];
  if (typeof method !== "function") {
    return Effect.die(`ProcessStore method missing: ${String(methodName)}`);
  }
  return Reflect.apply(method, api, args) satisfies PersistEffect;
};

const isCompleteEmitStatics = <EmitApi extends Record<string, unknown>>(
  out: { [P in keyof EmitApi & string]?: EmitMethod<EmitApi[P]> },
  keys: ReadonlyArray<keyof EmitApi & string>,
): out is OptionalEmitStatics<EmitApi> => keys.every((key) => out[key] !== undefined);

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
              onSome: (api): PersistEffect => callPersistMethod(api, emitKey, args),
            }),
          ),
        ),
      )) as EmitMethod<EmitApi[typeof emitKey]>;
  }
  if (!isCompleteEmitStatics(out, emitKeys)) {
    throw new Error(`ProcessStore facet ${id}: incomplete emit statics`);
  }
  return out satisfies OptionalEmitStatics<EmitApi>;
};

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
): ProcessStoreFacetClass<Self, Id, EmitApi, ReadApi> => {
  const facetBrand = {} satisfies ProcessStoreFacetBrand<EmitApi, ReadApi>;
  const assembled = Object.assign(
    Base,
    { layerRuntimeStorage, layer },
    emitStatics,
    facetBrand,
  );
  return assembled as ProcessStoreFacetClass<Self, Id, EmitApi, ReadApi>;
};

/** @internal */
export const defineProcessStoreFacet = <Self>() =>
  <const Id extends string, EmitApi extends Record<string, unknown>, ReadApi extends Record<string, unknown>>(
    id: Id,
    recordSection: ProcessStoreRecordSection<EmitApi>,
    readSection: ProcessStoreReadSection<ReadApi>,
  ): ProcessStoreFacetClass<Self, Id, EmitApi, ReadApi> => {
    const make: Effect.Effect<EmitApi & ReadApi, never, RuntimeStorage> = Effect.gen(
      function* () {
        const s = yield* buildStore;
        return mergeServiceShape(recordSection.fn(s), readSection.fn(s));
      },
    );

    const Base = Context.Service<Self, EmitApi & ReadApi>()(id, { make });

    const emitStatics = buildEmitStatics(id, recordSection.emitKeys, Base);

    const layerRuntimeStorage = Layer.effect(Base, make);
    const layer = Layer.provide(layerRuntimeStorage, RuntimeStorage.layer);

    return assembleFacetClass(Base, layerRuntimeStorage, layer, emitStatics);
  };
