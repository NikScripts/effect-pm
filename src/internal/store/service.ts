/**
 * Internal factory powering {@link ProcessStore.Service}.
 *
 * @module ProcessStoreFacetService
 * @internal
 */

import { Clock, Context, Effect, Layer, Record, Schema } from "effect";
import type { ProcessStoreWriteError } from "../../ProcessStoreEvent";
import { RuntimeStorage } from "../../RuntimeStorage";
import type { RuntimeStorageOperationalError } from "../../RuntimeStorage";
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
const METHOD_TAG = "ProcessStore/method" as const;
const FOR_METHOD_TAG = "ProcessStore/forMethod" as const;
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

/** @internal */
export type ProcessStoreFullIdentifierInput =
  | string
  | { readonly id: string }
  | { readonly _tag: string; readonly id: string };

type EmitMethod<F> = F extends (...args: infer A) => unknown
  ? (...args: A) => EmitEffect
  : never;

// ============================================================================
// Schema-annotated method types
// ============================================================================

/**
 * Sealed query method carrying payload + success schemas alongside the resolver.
 * Produced by the `ProcessStore.payload().success().resolve()` chain.
 *
 * @internal
 */
export interface ProcessStoreMethod<
  P extends Schema.Schema<any>,
  S extends Schema.Schema<any>,
> {
  readonly _tag: typeof METHOD_TAG;
  readonly payload: P;
  readonly success: S;
  readonly resolve: (
    s: ProcessStoreSpine,
  ) => (
    payload: Schema.Schema.Type<P>,
  ) => Effect.Effect<Schema.Schema.Type<S>, RuntimeStorageOperationalError>;
}

/**
 * Sealed identifier-bound method. Resolver receives `id` before the spine.
 *
 * @internal
 */
export interface ProcessStoreForMethod<
  P extends Schema.Schema<any>,
  S extends Schema.Schema<any>,
> {
  readonly _tag: typeof FOR_METHOD_TAG;
  readonly payload: P;
  readonly success: S;
  readonly resolve: (
    id: string,
    s: ProcessStoreSpine,
  ) => (
    payload: Schema.Schema.Type<P>,
  ) => Effect.Effect<Schema.Schema.Type<S>, RuntimeStorageOperationalError>;
}

/**
 * Generic RPC client used by `layerRemote` — decoupled from `StoreTransportRpc`.
 *
 * @internal
 */
export interface ProcessStoreQueryClient {
  readonly query: (
    facet: string,
    method: string,
    payload: unknown,
  ) => Effect.Effect<unknown, unknown>;
  readonly queryFor: (
    facet: string,
    id: string,
    method: string,
    payload: unknown,
  ) => Effect.Effect<unknown, unknown>;
}

// ============================================================================
// Chain builder types
// ============================================================================

/** @internal */
export interface MethodBuilder<
  P extends Schema.Schema<any>,
  S extends Schema.Schema<any>,
> {
  /**
   * Query method resolver — `(s) => (payload) => Effect`.
   * Use inside `ProcessStore.query({})`.
   */
  resolve(
    fn: (
      s: ProcessStoreSpine,
    ) => (
      payload: Schema.Schema.Type<P>,
    ) => Effect.Effect<Schema.Schema.Type<S>, RuntimeStorageOperationalError>,
  ): ProcessStoreMethod<P, S>;
  /**
   * For-method resolver — `(id, s) => (payload) => Effect`.
   * Use inside `ProcessStore.for({})`.
   */
  resolve(
    fn: (
      id: string,
      s: ProcessStoreSpine,
    ) => (
      payload: Schema.Schema.Type<P>,
    ) => Effect.Effect<Schema.Schema.Type<S>, RuntimeStorageOperationalError>,
  ): ProcessStoreForMethod<P, S>;
}

/** @internal */
export interface PayloadBuilder<P extends Schema.Schema<any>> {
  success<S extends Schema.Schema<any>>(schema: S): MethodBuilder<P, S>;
}

/**
 * Start the `ProcessStore.payload(S).success(S).resolve(fn)` chain.
 *
 * @internal
 */
export const processStorePayload = <P extends Schema.Schema<any>>(
  payload: P,
): PayloadBuilder<P> => ({
  success: <S extends Schema.Schema<any>>(success: S): MethodBuilder<P, S> => ({
    resolve: (fn: any): any => ({
      _tag: fn.length >= 2 ? FOR_METHOD_TAG : METHOD_TAG,
      payload,
      success,
      resolve: fn,
    }),
  }),
});

// ============================================================================
// Type-level helpers for methods maps
// ============================================================================

type QueryApiFromMethods<
  Methods extends Record<string, ProcessStoreMethod<any, any>>,
> = {
  readonly [K in keyof Methods & string]: (
    payload: Schema.Schema.Type<Methods[K]["payload"]>,
  ) => Effect.Effect<
    Schema.Schema.Type<Methods[K]["success"]>,
    RuntimeStorageOperationalError
  >;
};

type ForApiFromMethods<
  Methods extends Record<string, ProcessStoreMethod<any, any> | ProcessStoreForMethod<any, any>>,
> = {
  readonly [K in keyof Methods & string]: (
    payload: Schema.Schema.Type<Methods[K]["payload"]>,
  ) => Effect.Effect<
    Schema.Schema.Type<Methods[K]["success"]>,
    RuntimeStorageOperationalError
  >;
};

type SchemasFromMethods<
  Methods extends Record<
    string,
    ProcessStoreMethod<any, any> | ProcessStoreForMethod<any, any>
  >,
> = {
  readonly [K in keyof Methods]: {
    readonly payload: Methods[K]["payload"];
    readonly success: Methods[K]["success"];
  };
};

// ============================================================================
// Section types — brand
// ============================================================================

/**
 * Type-only hooks on the facet constructor; never read at runtime.
 *
 * @internal
 */
export type ProcessStoreFacetBrand<
  EmitApi,
  QueryApi,
  IdentifierApi,
  QuerySchemas,
  ForSchemas,
> = {
  readonly EmitApi?: EmitApi;
  readonly QueryApi?: QueryApi;
  readonly IdentifierApi?: IdentifierApi;
  readonly QuerySchemas?: QuerySchemas;
  readonly ForSchemas?: ForSchemas;
};

/** @internal */
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
export interface ProcessStoreQuerySection<
  Methods extends Record<string, ProcessStoreMethod<any, any>>,
> {
  readonly _tag: typeof QUERY_TAG;
  readonly methods: Methods;
}

/** @internal */
export interface ProcessStoreLegacyQuerySection<QueryApi> {
  readonly _tag: typeof QUERY_TAG;
  readonly fn: (s: ProcessStoreSpine) => QueryApi;
}

/** @internal */
export interface ProcessStoreForSection<
  Methods extends Record<string, ProcessStoreMethod<any, any> | ProcessStoreForMethod<any, any>>,
> {
  readonly _tag: typeof FOR_TAG;
  readonly methods: Methods;
}

/** @internal */
export interface ProcessStoreLegacyForSection<IdentifierApi> {
  readonly _tag: typeof FOR_TAG;
  readonly fn: (identifier: string, s: ProcessStoreSpine) => IdentifierApi;
}

type AnyQuerySection =
  | { readonly _tag: typeof QUERY_TAG; readonly methods: Record<string, ProcessStoreMethod<any, any>> }
  | { readonly _tag: typeof QUERY_TAG; readonly fn: (s: ProcessStoreSpine) => Record<string, unknown> };

type AnyForSection =
  | { readonly _tag: typeof FOR_TAG; readonly methods: Record<string, ProcessStoreMethod<any, any> | ProcessStoreForMethod<any, any>> }
  | { readonly _tag: typeof FOR_TAG; readonly fn: (id: string, s: ProcessStoreSpine) => Record<string, unknown> };

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
  | AnyQuerySection
  | AnyForSection;

// ============================================================================
// Section type extraction helpers
// ============================================================================

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
  ProcessStoreQuerySectionOf<Sections> extends ProcessStoreQuerySection<infer Methods>
    ? QueryApiFromMethods<Methods>
    : ProcessStoreQuerySectionOf<Sections> extends ProcessStoreLegacyQuerySection<
      infer QueryApi extends Record<string, unknown>
    >
      ? QueryApi
      : never;

type ProcessStoreIdentifierApiOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  [ProcessStoreForSectionOf<Sections>] extends [never]
    ? Record<never, never>
    : ProcessStoreForSectionOf<Sections> extends ProcessStoreForSection<
        infer Methods extends Record<string, ProcessStoreMethod<any, any> | ProcessStoreForMethod<any, any>>
      >
      ? ForApiFromMethods<Methods>
      : ProcessStoreForSectionOf<Sections> extends ProcessStoreLegacyForSection<
        infer IdentifierApi extends Record<string, unknown>
      >
        ? IdentifierApi
        : Record<never, never>;

type ProcessStoreQuerySchemasOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  ProcessStoreQuerySectionOf<Sections> extends ProcessStoreQuerySection<infer Methods>
    ? SchemasFromMethods<Methods>
    : Record<never, never>;

type ProcessStoreForSchemasOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  [ProcessStoreForSectionOf<Sections>] extends [never]
    ? Record<never, never>
    : ProcessStoreForSectionOf<Sections> extends ProcessStoreForSection<
        infer Methods extends Record<string, ProcessStoreMethod<any, any> | ProcessStoreForMethod<any, any>>
      >
      ? SchemasFromMethods<Methods>
      : Record<never, never>;

type IdentifierFactory<IdentifierApi> = {
  readonly [IDENTIFIER_FACTORY]: (identifier: string) => IdentifierApi;
};

type EmitApiFromFactories<
  Factories extends Record<string, (s: ProcessStoreSpine) => unknown>,
> = { readonly [K in keyof Factories]: ReturnType<Factories[K]> };

// ============================================================================
// Section constructors
// ============================================================================

/** @internal */
export const processStoreRecord = <
  const Factories extends Record<string, (s: ProcessStoreSpine) => unknown>,
>(
  factories: Factories,
): ProcessStoreRecordSection<EmitApiFromFactories<Factories>> => {
  type EmitApi = EmitApiFromFactories<Factories>;
  const emitKeys = Object.keys(factories) as Array<keyof EmitApi & string>;
  const fn = (s: ProcessStoreSpine): EmitApi =>
    Object.entries(factories).reduce<{ [key: string]: unknown }>(
      (out, [key, factory]) => { out[key] = factory(s); return out; },
      {},
    ) as EmitApi;
  return { _tag: RECORD_TAG, fn, emitKeys };
};

/** @internal */
export function processStoreQuery<
  const Methods extends Record<string, ProcessStoreMethod<any, any>>,
>(methods: Methods): ProcessStoreQuerySection<Methods>;
export function processStoreQuery<QueryApi extends Record<string, unknown>>(
  fn: (s: ProcessStoreSpine) => QueryApi,
): ProcessStoreLegacyQuerySection<QueryApi>;
export function processStoreQuery(
  methodsOrFn:
    | Record<string, ProcessStoreMethod<any, any>>
    | ((s: ProcessStoreSpine) => Record<string, unknown>),
): AnyQuerySection {
  if (typeof methodsOrFn === "function") {
    return { _tag: QUERY_TAG, fn: methodsOrFn };
  }
  return { _tag: QUERY_TAG, methods: methodsOrFn };
}

/** @internal */
export const processStoreLegacyQuery = <QueryApi>(
  fn: (s: ProcessStoreSpine) => QueryApi,
): ProcessStoreLegacyQuerySection<QueryApi> => ({ _tag: QUERY_TAG, fn });

/** @internal */
export function processStoreFor<
  const Methods extends Record<string, ProcessStoreMethod<any, any> | ProcessStoreForMethod<any, any>>,
>(methods: Methods): ProcessStoreForSection<Methods>;
export function processStoreFor<IdentifierApi extends Record<string, unknown>>(
  fn: (identifier: string, s: ProcessStoreSpine) => IdentifierApi,
): ProcessStoreLegacyForSection<IdentifierApi>;
export function processStoreFor(
  methodsOrFn:
    | Record<string, ProcessStoreForMethod<any, any>>
    | ((identifier: string, s: ProcessStoreSpine) => Record<string, unknown>),
): AnyForSection {
  if (typeof methodsOrFn === "function") {
    return { _tag: FOR_TAG, fn: methodsOrFn };
  }
  return { _tag: FOR_TAG, methods: methodsOrFn };
}

/** @internal */
export const processStoreLegacyFor = <IdentifierApi extends Record<string, unknown>>(
  fn: (identifier: string, s: ProcessStoreSpine) => IdentifierApi,
): ProcessStoreLegacyForSection<IdentifierApi> => ({ _tag: FOR_TAG, fn });

export { catchErrorAndLog, processStoreTelemetry };
export type { ProcessStoreCatchErrorAndLogOptions, TelemetryPart };

// ============================================================================
// Runtime helpers
// ============================================================================

const buildStore = Effect.gen(function* () {
  const storage = yield* RuntimeStorage;
  const now = yield* Clock.currentTimeMillis;
  return makeProcessStoreSpine(storage, makeRunId(now));
});

const bindQueryMethods = (
  methods: Record<string, ProcessStoreMethod<any, any>>,
  s: ProcessStoreSpine,
): Record<string, (payload: unknown) => Effect.Effect<unknown, RuntimeStorageOperationalError>> =>
  Record.map(methods, (m) => m.resolve(s));

const bindForMethods = (
  methods: Record<string, ProcessStoreMethod<any, any> | ProcessStoreForMethod<any, any>>,
  id: string,
  s: ProcessStoreSpine,
): Record<string, (payload: unknown) => Effect.Effect<unknown, RuntimeStorageOperationalError>> =>
  Record.map(methods, (m) =>
    m._tag === FOR_METHOD_TAG
      ? (m as ProcessStoreForMethod<any, any>).resolve(id, s)
      : (m as ProcessStoreMethod<any, any>).resolve(s),
  );

const extractSchemas = (
  methods: Record<string, { readonly payload: Schema.Schema<any>; readonly success: Schema.Schema<any> }>,
): Record<string, { payload: Schema.Schema<any>; success: Schema.Schema<any> }> =>
  Record.map(methods, (m) => ({ payload: m.payload, success: m.success }));

const resolveIdentifier = (identifier: ProcessStoreFullIdentifierInput): string =>
  typeof identifier === "string" ? identifier : identifier.id;

const attachIdentifierFactory = <
  ServiceApi extends object,
  IdentifierApi extends Record<string, unknown>,
>(
  service: ServiceApi,
  factory: (identifier: string) => IdentifierApi,
): ServiceApi => {
  Object.defineProperty(service, IDENTIFIER_FACTORY, { value: factory });
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

// ============================================================================
// Emit statics builders
// ============================================================================

const isCompleteEmitStatics = <EmitApi extends Record<string, unknown>>(
  out: { [P in keyof EmitApi & string]?: EmitMethod<EmitApi[P]> },
  keys: ReadonlyArray<keyof EmitApi & string>,
): out is OptionalEmitStatics<EmitApi> => keys.every((key) => out[key] !== undefined);

const isEmitEffect = (value: unknown): value is EmitEffect =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as EmitEffect).pipe === "function";

const isEmitFunction = (value: unknown): value is EmitFunction =>
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
  if (isEmitFunction(current)) return current(...args);
  if (!isEmitEffect(current)) return Effect.die(`ProcessStore telemetry path missing: ${path.join(".")}`);
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
    return Effect.die(`ProcessStore telemetry batch path missing: ${path.join(".")}`);
  }
  return current.batch(inputs);
};

const buildNestedEmitStatics = <Self, Id extends string, Shape>(
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
                callNestedEmitBatch(api as TelemetryNestedEmitApi, path, inputs),
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

// ============================================================================
// Facet class type
// ============================================================================

/** @internal */
export type OptionalEmitStatics<EmitApi> = {
  readonly [K in keyof EmitApi & string]: EmitMethod<EmitApi[K]>;
};

/** @internal */
export type ProcessStoreFacetClass<
  Self,
  Id extends string,
  Tag extends string,
  EmitApi,
  QueryApi,
  IdentifierApi,
  QuerySchemas,
  ForSchemas,
> = Context.ServiceClass<Self, Id, EmitApi & QueryApi> & {
  readonly _processTag:         Tag;
  readonly schemas:             QuerySchemas;
  readonly forSchemas:          ForSchemas;
  readonly make:                Effect.Effect<EmitApi & QueryApi, never, RuntimeStorage>;
  readonly layerRuntimeStorage: Layer.Layer<Self, never, RuntimeStorage>;
  readonly layer:               Layer.Layer<Self, never, never>;
  readonly layerQuery:          Layer.Layer<Context.Service<any, QueryApi>, never, Self>;
  readonly layerRemote:         (client: ProcessStoreQueryClient) => Layer.Layer<Context.Service<any, QueryApi>, never, never>;
  readonly Query:               Context.Service<any, QueryApi>;
  readonly forQuery:            keyof IdentifierApi extends never
    ? never
    : (id: ProcessStoreFullIdentifierInput) => Effect.Effect<IdentifierApi, never, Context.Service<any, QueryApi>>;
} & EmitApi
  & ProcessStoreFacetBrand<EmitApi, QueryApi, IdentifierApi, QuerySchemas, ForSchemas>
  & ProcessStoreIdentifierMember<Self, IdentifierApi>;

/** @internal */
export type ProcessStoreFacetShape<T> = T extends ProcessStoreFacetBrand<
  infer EmitApi,
  infer QueryApi,
  infer _IdentifierApi,
  infer _QuerySchemas,
  infer _ForSchemas
>
  ? EmitApi & QueryApi
  : never;

/** @internal */
export type ProcessStoreFacetEmitShape<T> = T extends ProcessStoreFacetBrand<
  infer EmitApi,
  infer _QueryApi,
  infer _IdentifierApi,
  infer _QuerySchemas,
  infer _ForSchemas
>
  ? EmitApi
  : never;

/** @internal */
export type ProcessStoreFacetQueryShape<T> = T extends ProcessStoreFacetBrand<
  infer _EmitApi,
  infer QueryApi,
  infer _IdentifierApi,
  infer _QuerySchemas,
  infer _ForSchemas
>
  ? QueryApi
  : never;

/** @internal */
export type ProcessStoreFacetIdentifierShape<T> = T extends ProcessStoreFacetBrand<
  infer _EmitApi,
  infer _QueryApi,
  infer IdentifierApi,
  infer _QuerySchemas,
  infer _ForSchemas
>
  ? IdentifierApi
  : never;

/** @internal */
export type ProcessStoreFacetQuerySchemas<T> = T extends ProcessStoreFacetBrand<
  infer _EmitApi,
  infer _QueryApi,
  infer _IdentifierApi,
  infer QuerySchemas,
  infer _ForSchemas
>
  ? QuerySchemas
  : never;

/** @internal */
export type ProcessStoreFacetForSchemas<T> = T extends ProcessStoreFacetBrand<
  infer _EmitApi,
  infer _QueryApi,
  infer _IdentifierApi,
  infer _QuerySchemas,
  infer ForSchemas
>
  ? ForSchemas
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

const mergeServiceShape = <EmitApi extends object, QueryApi extends object>(
  emitPart: EmitApi,
  queryPart: QueryApi,
): EmitApi & QueryApi => ({ ...emitPart, ...queryPart }) as EmitApi & QueryApi;

// ============================================================================
// Facet assembly
// ============================================================================

const assembleFacetClass = <
  Self,
  Id extends string,
  Tag extends string,
  EmitApi,
  QueryApi extends Record<string, unknown>,
  IdentifierApi extends Record<string, unknown>,
  QuerySchemas,
  ForSchemas,
>(
  Base: Context.ServiceClass<Self, Id, EmitApi & QueryApi>,
  processTag: Tag,
  layerRuntimeStorage: Layer.Layer<Self, never, RuntimeStorage>,
  layer: Layer.Layer<Self, never, never>,
  emitStatics: EmitApi,
  identifierMember: ProcessStoreIdentifierRuntimeMember<Self, IdentifierApi>,
  queryTag: Context.Service<any, QueryApi>,
  layerQuery: Layer.Layer<Context.Service<any, QueryApi>, never, Self>,
  layerRemote: (client: ProcessStoreQueryClient) => Layer.Layer<Context.Service<any, QueryApi>, never, never>,
  forQueryMember: Record<never, never> | { forQuery: (id: ProcessStoreFullIdentifierInput) => Effect.Effect<IdentifierApi, never, Context.Service<any, QueryApi>> },
  schemas: QuerySchemas,
  forSchemas: ForSchemas,
): ProcessStoreFacetClass<Self, Id, Tag, EmitApi, QueryApi, IdentifierApi, QuerySchemas, ForSchemas> => {
  const facetBrand = {} satisfies ProcessStoreFacetBrand<EmitApi, QueryApi, IdentifierApi, QuerySchemas, ForSchemas>;
  const assembled = Object.assign(
    Base,
    {
      _processTag: processTag,
      layerRuntimeStorage,
      layer,
      layerQuery,
      layerRemote,
      Query: queryTag,
      schemas,
      forSchemas,
    },
    emitStatics,
    identifierMember,
    forQueryMember,
    facetBrand,
  );
  return assembled as unknown as ProcessStoreFacetClass<Self, Id, Tag, EmitApi, QueryApi, IdentifierApi, QuerySchemas, ForSchemas>;
};

const buildIdentifierMember = <
  Self,
  Id extends string,
  EmitApi extends Record<string, unknown>,
  QueryApi extends Record<string, unknown>,
  IdentifierApi extends Record<string, unknown>,
>(
  anyForSection: AnyForSection | undefined,
  Base: Context.ServiceClass<Self, Id, EmitApi & QueryApi>,
): ProcessStoreIdentifierRuntimeMember<Self, IdentifierApi> => {
  if (anyForSection === undefined) return {};
  const getBoundApi = (
    identifier: ProcessStoreIdentifierInput,
  ): Effect.Effect<IdentifierApi, never, Self> =>
    Effect.flatMap(Base, (service) => {
      if (!hasIdentifierFactory<IdentifierApi>(service)) {
        return Effect.die("ProcessStore identifier factory missing");
      }
      return Effect.succeed(
        service[IDENTIFIER_FACTORY](
          typeof identifier === "string" ? identifier : identifier.id,
        ),
      );
    });
  return { for: getBoundApi };
};

const buildForQueryMember = <QueryApi, IdentifierApi extends Record<string, unknown>>(
  anyForSection: AnyForSection | undefined,
  queryTag: Context.Service<any, QueryApi>,
  forMethods: Record<string, ProcessStoreMethod<any, any> | ProcessStoreForMethod<any, any>> | undefined,
): Record<never, never> | { forQuery: (id: ProcessStoreFullIdentifierInput) => Effect.Effect<IdentifierApi, never, Context.Service<any, QueryApi>> } => {
  if (anyForSection === undefined) return {};
  const forQuery = (input: ProcessStoreFullIdentifierInput): Effect.Effect<IdentifierApi, never, Context.Service<any, QueryApi>> => {
    const id = resolveIdentifier(input);
    if (forMethods !== undefined) {
      return Effect.map(queryTag as any, (_s: ProcessStoreSpine) =>
        bindForMethods(forMethods, id, _s) as unknown as IdentifierApi,
      );
    }
    return Effect.flatMap(queryTag as any, (service: unknown) => {
      if (!hasIdentifierFactory<IdentifierApi>(service as any)) {
        return Effect.die("ProcessStore identifier factory missing on Query service");
      }
      return Effect.succeed((service as any)[IDENTIFIER_FACTORY](id));
    });
  };
  return { forQuery };
};

// ============================================================================
// Core factory
// ============================================================================

/** @internal */
export interface ProcessStoreFacetDefinition<Self> {
  <
    const Id extends string,
    const Tag extends string,
    const Sections extends ReadonlyArray<ProcessStoreFacetAnySection>,
  >(
    id: Id,
    processTag: Tag,
    ...sections: Sections
  ): ProcessStoreFacet<
    Self,
    Id,
    Tag,
    ProcessStoreEmitApiOf<Sections>,
    ProcessStoreQueryApiOf<Sections>,
    ProcessStoreIdentifierApiOf<Sections>,
    ProcessStoreQuerySchemasOf<Sections>,
    ProcessStoreForSchemasOf<Sections>
  >;
}

/** @internal */
export interface ProcessStoreFacetFactory {
  <Self>(): ProcessStoreFacetDefinition<Self>;
  <
    const Id extends string,
    const Tag extends string,
    const Sections extends ReadonlyArray<ProcessStoreFacetAnySection>,
  >(
    id: Id,
    processTag: Tag,
    ...sections: Sections
  ): ProcessStoreFacet<
    Id,
    Id,
    Tag,
    ProcessStoreEmitApiOf<Sections>,
    ProcessStoreQueryApiOf<Sections>,
    ProcessStoreIdentifierApiOf<Sections>,
    ProcessStoreQuerySchemasOf<Sections>,
    ProcessStoreForSchemasOf<Sections>
  >;
}

/** @internal */
export type ProcessStoreFacet<
  Self,
  Id extends string,
  Tag extends string,
  EmitApi,
  QueryApi,
  IdentifierApi,
  QuerySchemas,
  ForSchemas,
> = ProcessStoreFacetClass<Self, Id, Tag, EmitApi, QueryApi, IdentifierApi, QuerySchemas, ForSchemas>;

type HasMethods = {
  readonly _tag: string;
  readonly methods: Record<string, { readonly payload: Schema.Schema<any>; readonly success: Schema.Schema<any> }>;
};

const isMethodsSection = (
  s: AnyQuerySection | AnyForSection,
): s is (AnyQuerySection | AnyForSection) & HasMethods =>
  "methods" in s && typeof (s as any).methods === "object" && (s as any).methods !== null;

/** @internal */
const defineProcessStoreFacetFor = <Self>(): ProcessStoreFacetDefinition<Self> => {
  const define = <
    const Id extends string,
    const Tag extends string,
    const Sections extends ReadonlyArray<ProcessStoreFacetAnySection>,
  >(
    id: Id,
    processTag: Tag,
    ...sections: Sections
  ): ProcessStoreFacet<
    Self,
    Id,
    Tag,
    ProcessStoreEmitApiOf<Sections>,
    ProcessStoreQueryApiOf<Sections>,
    ProcessStoreIdentifierApiOf<Sections>,
    ProcessStoreQuerySchemasOf<Sections>,
    ProcessStoreForSchemasOf<Sections>
  > => {
    type EmitApi = ProcessStoreEmitApiOf<Sections>;
    type QueryApi = ProcessStoreQueryApiOf<Sections>;
    type IdentifierApi = ProcessStoreIdentifierApiOf<Sections>;
    type QuerySchemas = ProcessStoreQuerySchemasOf<Sections>;
    type ForSchemas = ProcessStoreForSchemasOf<Sections>;

    let recordSection: ProcessStoreRecordSection<Record<string, unknown>> | undefined;
    let telemetrySection: ProcessStoreTelemetrySection<TelemetryNestedEmitApi> | undefined;
    let anyQuerySection: AnyQuerySection | undefined;
    let anyForSection: AnyForSection | undefined;

    for (const section of sections) {
      switch (section._tag) {
        case RECORD_TAG:    recordSection    = section; break;
        case TELEMETRY_TAG: telemetrySection = section; break;
        case QUERY_TAG:     anyQuerySection  = section as AnyQuerySection; break;
        case FOR_TAG:       anyForSection    = section as AnyForSection; break;
      }
    }

    if (anyQuerySection === undefined) {
      throw new Error(`ProcessStore facet ${id}: query section is required`);
    }
    if (recordSection !== undefined && telemetrySection !== undefined) {
      throw new Error(`ProcessStore facet ${id}: use record or telemetry, not both`);
    }
    if (recordSection === undefined && telemetrySection === undefined) {
      throw new Error(`ProcessStore facet ${id}: record or telemetry section is required`);
    }

    const queryMethods = isMethodsSection(anyQuerySection)
      ? anyQuerySection.methods as Record<string, ProcessStoreMethod<any, any>>
      : undefined;
    const forMethods = anyForSection !== undefined && isMethodsSection(anyForSection)
      ? anyForSection.methods as Record<string, ProcessStoreMethod<any, any> | ProcessStoreForMethod<any, any>>
      : undefined;

    const make: Effect.Effect<EmitApi & QueryApi, never, RuntimeStorage> = Effect.gen(
      function* () {
        const s = yield* buildStore;
        const emitApi = (
          recordSection !== undefined ? recordSection.fn(s) : telemetrySection!.fn(s)
        ) as EmitApi;

        const queryApi = queryMethods !== undefined
          ? bindQueryMethods(queryMethods, s) as unknown as QueryApi
          : ("fn" in anyQuerySection! ? (anyQuerySection as any).fn(s) : {}) as QueryApi;

        const service = mergeServiceShape(emitApi, queryApi);

        if (anyForSection === undefined) return service;

        const boundForFactory = forMethods !== undefined
          ? (identifier: string) => bindForMethods(forMethods, identifier, s) as unknown as IdentifierApi
          : (identifier: string) =>
              ("fn" in anyForSection ? (anyForSection as any).fn(identifier, s) : {}) as IdentifierApi;

        return attachIdentifierFactory(service, boundForFactory);
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

    const identifierMember = buildIdentifierMember<Self, Id, EmitApi & Record<string, unknown>, Record<string, unknown>, IdentifierApi & Record<string, unknown>>(
      anyForSection,
      Base as any,
    );

    // .Query sub-tag — scoped to the facet id, provides read-only query API
    const queryTagId = `${id}/Query` as const;
    const queryTag = Context.Service<any, QueryApi>()(queryTagId) as unknown as Context.Service<any, QueryApi>;

    // layerQuery — derives read-only query view from the full local facet
    const layerQuery: Layer.Layer<Context.Service<any, QueryApi>, never, Self> = Layer.effect(
      queryTag as any,
      Effect.map(Base, (instance) =>
        queryMethods !== undefined
          ? Record.map(queryMethods, (_, key) => (instance as any)[key]) as unknown as QueryApi
          : (instance as unknown as QueryApi),
      ),
    ) as any;

    // layerRemote — routes queries over RPC, no local dependencies
    const makeLayerRemote = (client: ProcessStoreQueryClient): Layer.Layer<Context.Service<any, QueryApi>, never, never> => {
      const remoteQueryApi = queryMethods !== undefined
        ? Record.map(queryMethods, (_, methodName) =>
            (payload: unknown) => client.query(processTag, methodName, payload),
          ) as unknown as QueryApi
        : {} as QueryApi;
      return Layer.succeed(queryTag as any, remoteQueryApi) as any;
    };

    const forQueryMember = buildForQueryMember<QueryApi, IdentifierApi & Record<string, unknown>>(
      anyForSection,
      queryTag,
      forMethods,
    );

    const schemas = (
      queryMethods !== undefined ? extractSchemas(queryMethods) : {}
    ) as QuerySchemas;

    const forSchemas = (
      forMethods !== undefined ? extractSchemas(forMethods) : {}
    ) as ForSchemas;

    return assembleFacetClass<Self, Id, Tag, EmitApi, QueryApi & Record<string, unknown>, IdentifierApi & Record<string, unknown>, QuerySchemas, ForSchemas>(
      Base as any,
      processTag,
      layerRuntimeStorage,
      layer,
      emitStatics,
      identifierMember,
      queryTag,
      layerQuery as any,
      makeLayerRemote,
      forQueryMember as any,
      schemas,
      forSchemas,
    ) as any;
  };

  return define;
};

/** @internal */
export const defineProcessStoreFacet: ProcessStoreFacetFactory = ((
  idOrVoid?: string,
  processTagOrSection?: string | ProcessStoreFacetAnySection,
  ...rest: ReadonlyArray<ProcessStoreFacetAnySection>
) => {
  const define = defineProcessStoreFacetFor();
  if (idOrVoid === undefined) {
    return define;
  }
  const id = idOrVoid;
  if (typeof processTagOrSection === "string") {
    return define(id, processTagOrSection, ...rest);
  }
  // Backward compat: processTag omitted, use last path segment of id
  const fallbackTag = id.split("/").pop() ?? id;
  const sections = processTagOrSection !== undefined
    ? [processTagOrSection, ...rest]
    : rest;
  return define(id, fallbackTag, ...sections);
}) as ProcessStoreFacetFactory;

// ============================================================================
// Registry
// ============================================================================

type AnyFacetClass = {
  readonly _processTag: string;
  readonly schemas: Record<string, { payload: Schema.Schema<any>; success: Schema.Schema<any> }>;
  readonly forSchemas: Record<string, { payload: Schema.Schema<any>; success: Schema.Schema<any> }>;
};

type RegistryTypeMap<Facets extends ReadonlyArray<AnyFacetClass>> = {
  [F in Facets[number] as F["_processTag"]]: {
    [M in keyof F["schemas"]]: {
      payload: Schema.Schema.Type<F["schemas"][M]["payload"]>;
      success: Schema.Schema.Type<F["schemas"][M]["success"]>;
    };
  };
};

type RegistryForTypeMap<Facets extends ReadonlyArray<AnyFacetClass>> = {
  [F in Facets[number] as F["_processTag"]]: {
    [M in keyof F["forSchemas"]]: {
      payload: Schema.Schema.Type<F["forSchemas"][M]["payload"]>;
      success: Schema.Schema.Type<F["forSchemas"][M]["success"]>;
    };
  };
};

/** @public */
export interface ProcessStoreRegistry<Facets extends ReadonlyArray<AnyFacetClass>> {
  readonly typeMap:    RegistryTypeMap<Facets>;
  readonly forTypeMap: RegistryForTypeMap<Facets>;
  readonly lookup: Record<string, Record<string, {
    payload: Schema.Schema<any>;
    success: Schema.Schema<any>;
    resolve: (s: ProcessStoreSpine) => (p: unknown) => Effect.Effect<unknown, RuntimeStorageOperationalError>;
  }>>;
  readonly forLookup: Record<string, Record<string, {
    payload: Schema.Schema<any>;
    success: Schema.Schema<any>;
    resolve: (id: string, s: ProcessStoreSpine) => (p: unknown) => Effect.Effect<unknown, RuntimeStorageOperationalError>;
  }>>;
}

/** @internal */
export const processStoreRegistry = <
  const Facets extends ReadonlyArray<AnyFacetClass>,
>(
  facets: Facets,
): ProcessStoreRegistry<Facets> => {
  const lookup: Record<string, Record<string, any>> = {};
  const forLookup: Record<string, Record<string, any>> = {};

  for (const facet of facets) {
    lookup[facet._processTag] = facet.schemas;
    forLookup[facet._processTag] = facet.forSchemas;
  }

  return {
    typeMap:    {} as RegistryTypeMap<Facets>,
    forTypeMap: {} as RegistryForTypeMap<Facets>,
    lookup,
    forLookup,
  };
};
