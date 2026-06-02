/**
 * Internal factory powering {@link ProcessStore.Service}.
 *
 * @module ProcessStoreFacetService
 * @internal
 */

import { Clock, Context, Effect, Layer } from "effect";
import type { ProcessStoreWriteError } from "../../ProcessStoreEvent";
import { RuntimeStorage } from "../../RuntimeStorage";
import {
  catchErrorAndLog,
  optionalFacetEmit,
  type ProcessStoreCatchErrorAndLogOptions,
  makeRunId,
} from "./helpers";
import { makeProcessStoreSpine, type ProcessStoreSpine } from "./spine";
import {
  processStoreTelemetry,
  type ProcessStoreTelemetrySection,
  type TelemetryEmitPath,
  type TelemetryNestedEmitApi,
  type TelemetryPart,
} from "./telemetry";

const RECORD_TAG = "ProcessStore/record" as const;
const TELEMETRY_TAG = "ProcessStore/telemetry" as const;
const QUERY_TAG = "ProcessStore/query" as const;
const FOR_TAG = "ProcessStore/for" as const;
const IDENTIFIER_FACTORY = Symbol.for("@nikscripts/effect-pm/ProcessStore/identifierFactory");

type PersistEffect = Effect.Effect<void, ProcessStoreWriteError>;

type EmitEffect = Effect.Effect<void, ProcessStoreWriteError>;
type EmitFunction = (...args: ReadonlyArray<unknown>) => EmitEffect;
type EmitBatchFunction = EmitFunction & {
  readonly batch: (args: ReadonlyArray<unknown>) => EmitEffect;
};

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
export type ProcessStoreFacetBrand<EmitApi, QueryApi, IdentifierApi> = {
  readonly EmitApi?: EmitApi;
  readonly QueryApi?: QueryApi;
  readonly IdentifierApi?: IdentifierApi;
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
export interface ProcessStoreQuerySection<QueryApi> {
  readonly _tag: typeof QUERY_TAG;
  readonly fn: (s: ProcessStoreSpine) => QueryApi;
}

/** @internal */
export interface ProcessStoreForSection<IdentifierApi> {
  readonly _tag: typeof FOR_TAG;
  readonly fn: (identifier: string, s: ProcessStoreSpine) => IdentifierApi;
}

type ProcessStoreFacetAnySection =
  | {
      readonly _tag: typeof RECORD_TAG;
      readonly fn: (s: ProcessStoreSpine) => Record<string, unknown>;
      readonly emitKeys: ReadonlyArray<string>;
    }
  | {
      readonly _tag: typeof TELEMETRY_TAG;
      readonly fn: (s: ProcessStoreSpine) => TelemetryNestedEmitApi;
      readonly emitTree: TelemetryNestedEmitApi;
      readonly emitPaths: ReadonlyArray<TelemetryEmitPath>;
      readonly wireIds: ReadonlyArray<string>;
      readonly metadata: ProcessStoreTelemetrySection<TelemetryNestedEmitApi>["metadata"];
    }
  | {
      readonly _tag: typeof QUERY_TAG;
      readonly fn: (s: ProcessStoreSpine) => Record<string, unknown>;
    }
  | {
      readonly _tag: typeof FOR_TAG;
      readonly fn: (identifier: string, s: ProcessStoreSpine) => Record<string, unknown>;
    };

type ProcessStoreRecordSectionOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  Extract<Sections[number], { readonly _tag: typeof RECORD_TAG }>;

type ProcessStoreQuerySectionOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  Extract<Sections[number], { readonly _tag: typeof QUERY_TAG }>;

type ProcessStoreForSectionOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  Extract<Sections[number], { readonly _tag: typeof FOR_TAG }>;

type ProcessStoreTelemetrySectionOf<
  Sections extends ReadonlyArray<ProcessStoreFacetAnySection>,
> = Extract<Sections[number], { readonly _tag: typeof TELEMETRY_TAG }>;

type ProcessStoreEmitApiOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  [ProcessStoreRecordSectionOf<Sections>] extends [never]
    ? ProcessStoreTelemetrySectionOf<Sections> extends ProcessStoreTelemetrySection<
      infer EmitApi extends object
    >
      ? EmitApi
      : never
    : ProcessStoreRecordSectionOf<Sections> extends ProcessStoreRecordSection<
      infer EmitApi extends Record<string, unknown>
    >
      ? EmitApi
      : never;

type ProcessStoreQueryApiOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  ProcessStoreQuerySectionOf<Sections> extends ProcessStoreQuerySection<
    infer QueryApi extends Record<string, unknown>
  >
    ? QueryApi
    : never;

type ProcessStoreIdentifierApiOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  [ProcessStoreForSectionOf<Sections>] extends [never]
    ? Record<never, never>
    : ProcessStoreForSectionOf<Sections> extends ProcessStoreForSection<
      infer IdentifierApi extends Record<string, unknown>
    >
      ? IdentifierApi
      : Record<never, never>;

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
export const processStoreQuery = <QueryApi>(
  fn: (s: ProcessStoreSpine) => QueryApi,
): ProcessStoreQuerySection<QueryApi> => ({
  _tag: QUERY_TAG,
  fn,
});

/** @internal */
export const processStoreFor = <IdentifierApi extends Record<string, unknown>>(
  fn: (identifier: string, s: ProcessStoreSpine) => IdentifierApi,
): ProcessStoreForSection<IdentifierApi> => ({
  _tag: FOR_TAG,
  fn,
});

export { catchErrorAndLog, processStoreTelemetry };
export type { ProcessStoreCatchErrorAndLogOptions, TelemetryPart };

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
  QueryApi,
  IdentifierApi,
> = Context.ServiceClass<Self, Id, EmitApi & QueryApi> & {
  readonly make: Effect.Effect<EmitApi & QueryApi, never, RuntimeStorage>;
  readonly layerRuntimeStorage: Layer.Layer<Self, never, RuntimeStorage>;
  readonly layer: Layer.Layer<Self, never, never>;
} & EmitApi &
  ProcessStoreFacetBrand<EmitApi, QueryApi, IdentifierApi> &
  ProcessStoreIdentifierMember<Self, IdentifierApi>;

/** @internal */
export type ProcessStoreFacetShape<T> = T extends ProcessStoreFacetBrand<
  infer EmitApi,
  infer QueryApi,
  infer _IdentifierApi
>
  ? EmitApi & QueryApi
  : never;

/** @internal */
export type ProcessStoreFacetEmitShape<T> = T extends ProcessStoreFacetBrand<
  infer EmitApi,
  infer _QueryApi,
  infer _IdentifierApi
>
  ? EmitApi
  : never;

/** @internal */
export type ProcessStoreFacetQueryShape<T> = T extends ProcessStoreFacetBrand<
  infer _EmitApi,
  infer QueryApi,
  infer _IdentifierApi
>
  ? QueryApi
  : never;

/** @internal */
export type ProcessStoreFacetIdentifierShape<T> = T extends ProcessStoreFacetBrand<
  infer _EmitApi,
  infer _QueryApi,
  infer IdentifierApi
>
  ? IdentifierApi
  : never;

type ProcessStoreIdentifierEffect<Self, IdentifierApi> = {
  readonly for: (
    identifier: ProcessStoreIdentifierInput,
  ) => Effect.Effect<IdentifierApi, never, Self>;
};

type ProcessStoreIdentifierMember<Self, IdentifierApi> = keyof IdentifierApi extends never
  ? Record<never, never>
  : ProcessStoreIdentifierEffect<Self, IdentifierApi>;

type ProcessStoreIdentifierRuntimeMember<Self, IdentifierApi> =
  | Record<never, never>
  | ProcessStoreIdentifierEffect<Self, IdentifierApi>;

const mergeServiceShape = <
  EmitApi extends object,
  QueryApi extends object,
>(
  emitPart: EmitApi,
  queryPart: QueryApi,
): EmitApi & QueryApi =>
  ({ ...emitPart, ...queryPart }) as EmitApi & QueryApi;

const isEmitEffect = (value: unknown): value is EmitEffect =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as EmitEffect).pipe === "function";

const isEmitFunction = (
  value: unknown,
): value is EmitFunction =>
  typeof value === "function";

const hasEmitBatch = (value: EmitFunction): value is EmitBatchFunction =>
  typeof (value as { readonly batch?: unknown }).batch === "function";

const callNestedEmit = (
  api: TelemetryNestedEmitApi,
  path: ReadonlyArray<string>,
  args: ReadonlyArray<unknown>,
): EmitEffect => {
  let current: TelemetryNestedEmitApi | EmitEffect | ((...args: ReadonlyArray<unknown>) => EmitEffect) = api;
  for (const segment of path) {
    if (!isEmitEffect(current) && !isEmitFunction(current)) {
      current = (current as TelemetryNestedEmitApi)[segment] as
        | TelemetryNestedEmitApi
        | EmitEffect
        | ((...args: ReadonlyArray<unknown>) => EmitEffect);
    }
  }
  if (isEmitFunction(current)) {
    return current(...args);
  }
  if (!isEmitEffect(current)) {
    return Effect.die(
      `ProcessStore telemetry path missing: ${path.join(".")}`,
    );
  }
  return current;
};

const callNestedEmitBatch = (
  api: TelemetryNestedEmitApi,
  path: ReadonlyArray<string>,
  inputs: ReadonlyArray<unknown>,
): EmitEffect => {
  let current: TelemetryNestedEmitApi | EmitEffect | EmitFunction = api;
  for (const segment of path) {
    if (!isEmitEffect(current) && !isEmitFunction(current)) {
      current = (current as TelemetryNestedEmitApi)[segment] as
        | TelemetryNestedEmitApi
        | EmitEffect
        | EmitFunction;
    }
  }
  if (!isEmitFunction(current) || !hasEmitBatch(current)) {
    return Effect.die(
      `ProcessStore telemetry batch path missing: ${path.join(".")}`,
    );
  }
  return current.batch(inputs);
};

const resolveIdentifier = (identifier: ProcessStoreIdentifierInput): string =>
  typeof identifier === "string" ? identifier : identifier.id;

const attachIdentifierFactory = <
  ServiceApi extends object,
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

const buildNestedEmitStatics = <
  Self,
  Id extends string,
  Shape,
>(
  paths: ReadonlyArray<TelemetryEmitPath>,
  Base: Context.ServiceClass<Self, Id, Shape>,
): TelemetryNestedEmitApi => {
  const out: Record<string, unknown> = {};
  for (const emitPath of paths) {
    const path = emitPath.path;
    let node = out;
    for (let i = 0; i < path.length - 1; i += 1) {
      const segment = path[i]!;
      const next = (node[segment] ?? {}) as Record<string, unknown>;
      node[segment] = next;
      node = next;
    }
    const leaf = path[path.length - 1]!;
    node[leaf] = emitPath.input
      ? Object.assign(
          (input: unknown) =>
            optionalFacetEmit(Base, (api): EmitEffect =>
              callNestedEmit(api as TelemetryNestedEmitApi, path, [input]),
            ),
          {
            batch: (inputs: ReadonlyArray<unknown>) =>
              optionalFacetEmit(Base, (api): EmitEffect =>
                callNestedEmitBatch(
                  api as TelemetryNestedEmitApi,
                  path,
                  inputs,
                ),
              ),
          },
        )
      : optionalFacetEmit(Base, (api): EmitEffect =>
          callNestedEmit(api as TelemetryNestedEmitApi, path, []),
        );
  }
  return out as TelemetryNestedEmitApi;
};

const buildEmitStatics = <
  Self,
  Id extends string,
  EmitApi extends Record<string, unknown>,
  QueryApi,
>(
  id: Id,
  emitKeys: ReadonlyArray<keyof EmitApi & string>,
  Base: Context.ServiceClass<Self, Id, EmitApi & QueryApi>,
): OptionalEmitStatics<EmitApi> => {
  const out: { [K in keyof EmitApi & string]?: EmitMethod<EmitApi[K]> } = {};
  for (const emitKey of emitKeys) {
    out[emitKey] = ((...args: ReadonlyArray<unknown>) =>
      optionalFacetEmit(Base, (api): PersistEffect =>
        callPersistMethod(api, emitKey, args),
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
  EmitApi,
  QueryApi extends Record<string, unknown>,
  IdentifierApi extends Record<string, unknown>,
>(
  Base: Context.ServiceClass<Self, Id, EmitApi & QueryApi>,
  layerRuntimeStorage: Layer.Layer<Self, never, RuntimeStorage>,
  layer: Layer.Layer<Self, never, never>,
  emitStatics: EmitApi,
  identifierMember: ProcessStoreIdentifierRuntimeMember<Self, IdentifierApi>,
): ProcessStoreFacetClass<Self, Id, EmitApi, QueryApi, IdentifierApi> => {
  const facetBrand = {} satisfies ProcessStoreFacetBrand<EmitApi, QueryApi, IdentifierApi>;
  const assembled = Object.assign(
    Base,
    { layerRuntimeStorage, layer },
    emitStatics,
    identifierMember,
    facetBrand,
  );
  return assembled as ProcessStoreFacet<Self, Id, EmitApi, QueryApi, IdentifierApi>;
};

const buildIdentifierMember = <
  Self,
  Id extends string,
  EmitApi extends Record<string, unknown>,
  QueryApi extends Record<string, unknown>,
  IdentifierApi extends Record<string, unknown>,
>(
  forSection: ProcessStoreForSection<IdentifierApi> | undefined,
  Base: Context.ServiceClass<Self, Id, EmitApi & QueryApi>,
): ProcessStoreIdentifierRuntimeMember<Self, IdentifierApi> => {
  if (forSection === undefined) {
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
  ): ProcessStoreFacet<
    Self,
    Id,
    ProcessStoreEmitApiOf<Sections>,
    ProcessStoreQueryApiOf<Sections>,
    ProcessStoreIdentifierApiOf<Sections>
  >;
}

/** @internal */
export interface ProcessStoreFacetFactory {
  <Self>(): ProcessStoreFacetDefinition<Self>;
  <
    const Id extends string,
    const Sections extends ReadonlyArray<ProcessStoreFacetAnySection>,
  >(
    id: Id,
    ...sections: Sections
  ): ProcessStoreFacet<
    Id,
    Id,
    ProcessStoreEmitApiOf<Sections>,
    ProcessStoreQueryApiOf<Sections>,
    ProcessStoreIdentifierApiOf<Sections>
  >;
}

/** @internal */
export type ProcessStoreFacet<
  Self,
  Id extends string,
  EmitApi,
  QueryApi,
  IdentifierApi,
> = ProcessStoreFacetClass<Self, Id, EmitApi, QueryApi, IdentifierApi>;

/** @internal */
const defineProcessStoreFacetFor = <Self>(): ProcessStoreFacetDefinition<Self> => {
  const define = <
    const Id extends string,
    const Sections extends ReadonlyArray<ProcessStoreFacetAnySection>,
  >(
    id: Id,
    ...sections: Sections
  ): ProcessStoreFacet<
    Self,
    Id,
    ProcessStoreEmitApiOf<Sections>,
    ProcessStoreQueryApiOf<Sections>,
    ProcessStoreIdentifierApiOf<Sections>
  > => {
    type EmitApi = ProcessStoreEmitApiOf<Sections>;
    type QueryApi = ProcessStoreQueryApiOf<Sections>;
    type IdentifierApi = ProcessStoreIdentifierApiOf<Sections>;

    let recordSection: ProcessStoreRecordSection<Record<string, unknown>> | undefined;
    let telemetrySection:
      | ProcessStoreTelemetrySection<TelemetryNestedEmitApi>
      | undefined;
    let querySection: ProcessStoreQuerySection<Record<string, unknown>> | undefined;
    let forSection: ProcessStoreForSection<Record<string, unknown>> | undefined;

    for (const section of sections) {
      switch (section._tag) {
        case RECORD_TAG:
          recordSection = section;
          break;
        case TELEMETRY_TAG:
          telemetrySection = section;
          break;
        case QUERY_TAG:
          querySection = section;
          break;
        case FOR_TAG:
          forSection = section;
          break;
      }
    }

    if (querySection === undefined) {
      throw new Error(`ProcessStore facet ${id}: query section is required`);
    }
    if (recordSection !== undefined && telemetrySection !== undefined) {
      throw new Error(
        `ProcessStore facet ${id}: use record or telemetry, not both`,
      );
    }
    if (recordSection === undefined && telemetrySection === undefined) {
      throw new Error(
        `ProcessStore facet ${id}: record or telemetry section is required`,
      );
    }

    const make: Effect.Effect<EmitApi & QueryApi, never, RuntimeStorage> = Effect.gen(
      function* () {
        const s = yield* buildStore;
        const emitApi = (
          recordSection !== undefined
            ? recordSection.fn(s)
            : telemetrySection!.fn(s)
        ) as EmitApi;
        const queryApi = querySection.fn(s) as QueryApi;
        const service = mergeServiceShape(emitApi, queryApi);
        if (forSection === undefined) {
          return service;
        }
        return attachIdentifierFactory(
          service,
          (identifier) => forSection.fn(identifier, s) as IdentifierApi,
        );
      },
    );

    const Base = Context.Service<Self, EmitApi & QueryApi>()(id, { make });

    const emitStatics = (
      telemetrySection !== undefined
        ? buildNestedEmitStatics(telemetrySection.emitPaths, Base)
        : buildEmitStatics(
            id,
            recordSection!.emitKeys as ReadonlyArray<keyof EmitApi & string>,
            Base,
          )
    ) as EmitApi;

    const layerRuntimeStorage = Layer.effect(Base, make);
    const layer = Layer.provide(layerRuntimeStorage, RuntimeStorage.layer);
    const identifierMember = buildIdentifierMember(
      forSection as ProcessStoreForSection<IdentifierApi> | undefined,
      Base,
    );

    return assembleFacetClass<Self, Id, EmitApi, QueryApi, IdentifierApi>(
      Base,
      layerRuntimeStorage,
      layer,
      emitStatics,
      identifierMember,
    );
  };

  return define;
};

/** @internal */
export const defineProcessStoreFacet: ProcessStoreFacetFactory = ((
  id?: string,
  ...sections: ReadonlyArray<ProcessStoreFacetAnySection>
) => {
  const define = defineProcessStoreFacetFor();
  if (id === undefined) {
    return define;
  }
  return define(id, ...sections);
}) as ProcessStoreFacetFactory;
