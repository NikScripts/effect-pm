/**
 * Internal factory powering {@link ProcessStore.Service}.
 *
 * @module ProcessStoreFacetService
 * @internal
 */

import { Clock, Context, Effect, Layer, Option } from "effect";
import type { ProcessStoreWriteError } from "../../ProcessStoreEvent";
import { RuntimeStorage } from "../../RuntimeStorage";
import { makeRunId, wrapEmitForFacet } from "./helpers";
import { makeProcessStoreSpine, type ProcessStoreSpine } from "./spine";

const RECORD_TAG = "ProcessStore/record" as const;
const READ_TAG = "ProcessStore/read" as const;
const IDENTIFIER_TAG = "ProcessStore/identifier" as const;
const IDENTIFIER_FACTORY = Symbol.for("@nikscripts/effect-pm/ProcessStore/identifierFactory");

type PersistEffect = Effect.Effect<void, ProcessStoreWriteError>;

type EmitEffect = Effect.Effect<void>;

/** @internal */
export type ProcessStoreIdentifierInput =
  | string
  | { readonly id: string };

type EmitMethod<F> = F extends (...args: infer A) => unknown
  ? (...args: A) => EmitEffect
  : never;

/**
 * Type-only hooks on the facet constructor; never read at runtime.
 *
 * @internal
 */
export type ProcessStoreFacetBrand<EmitApi, ReadApi, IdentifierApi> = {
  readonly __processStoreEmit?: EmitApi;
  readonly __processStoreRead?: ReadApi;
  readonly __processStoreIdentifier?: IdentifierApi;
};

/**
 * Per-method factory map handed to {@link processStoreRecord}.
 *
 * @remarks
 * Each value is a function `(s) => method` so the builder can read the
 * record's keys from the object literal at module load time without
 * invoking the methods themselves. The methods only ever execute at
 * layer-construction time, with the real spine bound to `s`.
 *
 * @internal
 */
export type ProcessStoreRecordFactories<EmitApi> = {
  readonly [K in keyof EmitApi]: (s: ProcessStoreSpine) => EmitApi[K];
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

/** @internal */
export interface ProcessStoreIdentifierSection<IdentifierApi> {
  readonly _tag: typeof IDENTIFIER_TAG;
  readonly fn: (identifier: string, s: ProcessStoreSpine) => IdentifierApi;
}

type ProcessStoreFacetAnySection =
  | {
      readonly _tag: typeof RECORD_TAG;
      readonly fn: (s: ProcessStoreSpine) => Record<string, unknown>;
      readonly emitKeys: ReadonlyArray<string>;
    }
  | {
      readonly _tag: typeof READ_TAG;
      readonly fn: (s: ProcessStoreSpine) => Record<string, unknown>;
    }
  | {
      readonly _tag: typeof IDENTIFIER_TAG;
      readonly fn: (identifier: string, s: ProcessStoreSpine) => Record<string, unknown>;
    };

type ProcessStoreRecordSectionOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  Extract<Sections[number], { readonly _tag: typeof RECORD_TAG }>;

type ProcessStoreReadSectionOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  Extract<Sections[number], { readonly _tag: typeof READ_TAG }>;

type ProcessStoreIdentifierSectionOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  Extract<Sections[number], { readonly _tag: typeof IDENTIFIER_TAG }>;

type ProcessStoreEmitApiOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  ProcessStoreRecordSectionOf<Sections> extends ProcessStoreRecordSection<
    infer EmitApi extends Record<string, unknown>
  >
    ? EmitApi
    : never;

type ProcessStoreReadApiOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  ProcessStoreReadSectionOf<Sections> extends ProcessStoreReadSection<
    infer ReadApi extends Record<string, unknown>
  >
    ? ReadApi
    : never;

type ProcessStoreIdentifierApiOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  [ProcessStoreIdentifierSectionOf<Sections>] extends [never]
    ? {}
    : ProcessStoreIdentifierSectionOf<Sections> extends ProcessStoreIdentifierSection<
      infer IdentifierApi extends Record<string, unknown>
    >
      ? IdentifierApi
      : {};

type IdentifierFactory<IdentifierApi> = {
  readonly [IDENTIFIER_FACTORY]: (identifier: string) => IdentifierApi;
};

type EmitApiFromFactories<
  Factories extends Record<string, (s: ProcessStoreSpine) => unknown>,
> = { readonly [K in keyof Factories]: ReturnType<Factories[K]> };

/**
 * Declares the record (write) section of a facet.
 *
 * @remarks
 * Pass an object literal whose keys are the emit method names and whose
 * values are factories of shape `(s: ProcessStoreSpine) => method`. The
 * builder reads `Object.keys(...)` to discover the emit keys (used to
 * attach the optional static emitters) and binds each factory against
 * the real spine at layer-construction time.
 *
 * @internal
 */
export const processStoreRecord = <
  const Factories extends Record<string, (s: ProcessStoreSpine) => unknown>,
>(
  factories: Factories,
): ProcessStoreRecordSection<EmitApiFromFactories<Factories>> => {
  type EmitApi = EmitApiFromFactories<Factories>;
  const emitKeys = Object.keys(factories) as Array<keyof EmitApi & string>;
  const fn = (s: ProcessStoreSpine): EmitApi => {
    const out: { [key: string]: unknown } = {};
    for (const [key, factory] of Object.entries(factories)) {
      out[key] = factory(s);
    }
    return out as EmitApi;
  };
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

/** @internal */
export const processStoreWithIdentifier = <IdentifierApi extends Record<string, unknown>>(
  fn: (identifier: string, s: ProcessStoreSpine) => IdentifierApi,
): ProcessStoreIdentifierSection<IdentifierApi> => ({
  _tag: IDENTIFIER_TAG,
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
  IdentifierApi,
> = Context.ServiceClass<Self, Id, EmitApi & ReadApi> & {
  readonly make: Effect.Effect<EmitApi & ReadApi, never, RuntimeStorage>;
  readonly layerRuntimeStorage: Layer.Layer<Self, never, RuntimeStorage>;
  readonly layer: Layer.Layer<Self, never, never>;
} & ProcessStoreFacetBrand<EmitApi, ReadApi, IdentifierApi> &
  ProcessStoreIdentifierMember<Self, IdentifierApi> &
  OptionalEmitStatics<EmitApi>;

/** @internal */
export type ProcessStoreFacetShape<T> = T extends ProcessStoreFacetBrand<
  infer EmitApi,
  infer ReadApi,
  infer _IdentifierApi
>
  ? EmitApi & ReadApi
  : never;

/** @internal */
export type ProcessStoreFacetEmitShape<T> = T extends ProcessStoreFacetBrand<
  infer EmitApi,
  infer _ReadApi,
  infer _IdentifierApi
>
  ? EmitApi
  : never;

/** @internal */
export type ProcessStoreFacetIdentifierShape<T> = T extends ProcessStoreFacetBrand<
  infer _EmitApi,
  infer _ReadApi,
  infer IdentifierApi
>
  ? IdentifierApi
  : never;

type ProcessStoreIdentifierEffect<Self, IdentifierApi> = {
  readonly for: (
    identifier: ProcessStoreIdentifierInput,
  ) => Effect.Effect<IdentifierApi, never, Self>;
  readonly withIdentifier: (
    identifier: ProcessStoreIdentifierInput,
  ) => Effect.Effect<IdentifierApi, never, Self>;
};

type ProcessStoreIdentifierMember<Self, IdentifierApi> = keyof IdentifierApi extends never
  ? {}
  : ProcessStoreIdentifierEffect<Self, IdentifierApi>;

type ProcessStoreIdentifierRuntimeMember<Self, IdentifierApi> =
  | {}
  | ProcessStoreIdentifierEffect<Self, IdentifierApi>;

const mergeServiceShape = <EmitApi extends Record<string, unknown>, ReadApi extends Record<string, unknown>>(
  recordPart: EmitApi,
  readPart: ReadApi,
): EmitApi & ReadApi =>
  ({ ...recordPart, ...readPart }) satisfies EmitApi & ReadApi;

const resolveIdentifier = (identifier: ProcessStoreIdentifierInput): string =>
  typeof identifier === "string" ? identifier : identifier.id;

const attachIdentifierFactory = <
  ServiceApi extends Record<string, unknown>,
  IdentifierApi extends Record<string, unknown>,
>(
  service: ServiceApi,
  factory: (identifier: string) => IdentifierApi,
): ServiceApi => {
  Object.defineProperty(service, IDENTIFIER_FACTORY, {
    value: factory,
  });
  return service;
};

const hasIdentifierFactory = <IdentifierApi extends Record<string, unknown>>(
  service: Record<string | symbol, unknown>,
): service is IdentifierFactory<IdentifierApi> =>
  typeof service[IDENTIFIER_FACTORY] === "function";

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
  IdentifierApi extends Record<string, unknown>,
>(
  Base: Context.ServiceClass<Self, Id, EmitApi & ReadApi>,
  layerRuntimeStorage: Layer.Layer<Self, never, RuntimeStorage>,
  layer: Layer.Layer<Self, never, never>,
  emitStatics: OptionalEmitStatics<EmitApi>,
  identifierMember: ProcessStoreIdentifierRuntimeMember<Self, IdentifierApi>,
): ProcessStoreFacetClass<Self, Id, EmitApi, ReadApi, IdentifierApi> => {
  const facetBrand = {} satisfies ProcessStoreFacetBrand<EmitApi, ReadApi, IdentifierApi>;
  const assembled = Object.assign(
    Base,
    { layerRuntimeStorage, layer },
    emitStatics,
    identifierMember,
    facetBrand,
  );
  return assembled as ProcessStoreFacetClass<Self, Id, EmitApi, ReadApi, IdentifierApi>;
};

const buildIdentifierMember = <
  Self,
  Id extends string,
  EmitApi extends Record<string, unknown>,
  ReadApi extends Record<string, unknown>,
  IdentifierApi extends Record<string, unknown>,
>(
  identifierSection: ProcessStoreIdentifierSection<IdentifierApi> | undefined,
  Base: Context.ServiceClass<Self, Id, EmitApi & ReadApi>,
): ProcessStoreIdentifierRuntimeMember<Self, IdentifierApi> => {
  if (identifierSection === undefined) {
    return {};
  }
  const getBoundApi = (
    identifier: ProcessStoreIdentifierInput,
  ): Effect.Effect<IdentifierApi, never, Self> =>
    Effect.flatMap(Base, (service) => {
      if (!hasIdentifierFactory<IdentifierApi>(service)) {
        return Effect.die("ProcessStore identifier factory missing");
      }
      return Effect.succeed(service[IDENTIFIER_FACTORY](resolveIdentifier(identifier)));
    });
  return {
    for: getBoundApi,
    withIdentifier: getBoundApi,
  };
};

/** @internal */
export interface ProcessStoreFacetDefinition<Self> {
  <
    const Id extends string,
    const Sections extends ReadonlyArray<ProcessStoreFacetAnySection>,
  >(
    id: Id,
    ...sections: Sections
  ): ProcessStoreFacetClass<
    Self,
    Id,
    ProcessStoreEmitApiOf<Sections>,
    ProcessStoreReadApiOf<Sections>,
    ProcessStoreIdentifierApiOf<Sections>
  >;
}

/** @internal */
export const defineProcessStoreFacet = <Self>(): ProcessStoreFacetDefinition<Self> => {
  const define = <
    const Id extends string,
    const Sections extends ReadonlyArray<ProcessStoreFacetAnySection>,
  >(
    id: Id,
    ...sections: Sections
  ): ProcessStoreFacetClass<
    Self,
    Id,
    ProcessStoreEmitApiOf<Sections>,
    ProcessStoreReadApiOf<Sections>,
    ProcessStoreIdentifierApiOf<Sections>
  > => {
    type EmitApi = ProcessStoreEmitApiOf<Sections>;
    type ReadApi = ProcessStoreReadApiOf<Sections>;
    type IdentifierApi = ProcessStoreIdentifierApiOf<Sections>;

    let recordSection: ProcessStoreRecordSection<Record<string, unknown>> | undefined;
    let readSection: ProcessStoreReadSection<Record<string, unknown>> | undefined;
    let identifierSection: ProcessStoreIdentifierSection<Record<string, unknown>> | undefined;

    for (const section of sections) {
      switch (section._tag) {
        case RECORD_TAG:
          recordSection = section;
          break;
        case READ_TAG:
          readSection = section;
          break;
        case IDENTIFIER_TAG:
          identifierSection = section;
          break;
      }
    }

    if (recordSection === undefined || readSection === undefined) {
      throw new Error(`ProcessStore facet ${id}: record and read sections are required`);
    }

    const make: Effect.Effect<EmitApi & ReadApi, never, RuntimeStorage> = Effect.gen(
      function* () {
        const s = yield* buildStore;
        const recordApi = recordSection.fn(s) as EmitApi;
        const readApi = readSection.fn(s) as ReadApi;
        const service = mergeServiceShape(recordApi, readApi);
        if (identifierSection === undefined) {
          return service;
        }
        return attachIdentifierFactory(
          service,
          (identifier) => identifierSection.fn(identifier, s) as IdentifierApi,
        );
      },
    );

    const Base = Context.Service<Self, EmitApi & ReadApi>()(id, { make });

    const emitStatics = buildEmitStatics(
      id,
      recordSection.emitKeys as ReadonlyArray<keyof EmitApi & string>,
      Base,
    );

    const layerRuntimeStorage = Layer.effect(Base, make);
    const layer = Layer.provide(layerRuntimeStorage, RuntimeStorage.layer);
    const identifierMember = buildIdentifierMember(
      identifierSection as ProcessStoreIdentifierSection<IdentifierApi> | undefined,
      Base,
    );

    return assembleFacetClass<Self, Id, EmitApi, ReadApi, IdentifierApi>(
      Base,
      layerRuntimeStorage,
      layer,
      emitStatics,
      identifierMember,
    );
  };

  return define;
};
