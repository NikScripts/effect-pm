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

const TELEMETRY_TAG = "ProcessStore/telemetry" as const;
const QUERY_TAG = "ProcessStore/query" as const;
const FOR_TAG = "ProcessStore/for" as const;
const METHOD_TAG = "ProcessStore/method" as const;
const FOR_METHOD_TAG = "ProcessStore/forMethod" as const;
const IDENTIFIER_FACTORY = Symbol.for("@nikscripts/effect-pm/ProcessStore/identifierFactory");

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
   * For-method resolver — `(id, s) => (payload) => Effect`.
   * Use inside `ProcessStore.for({})`.
   * Checked first: first param is `string`, distinguishing it from the query resolver.
   */
  resolve(
    fn: (
      id: string,
      s: ProcessStoreSpine,
    ) => (
      payload: Schema.Schema.Type<P>,
    ) => Effect.Effect<Schema.Schema.Type<S>, RuntimeStorageOperationalError>,
  ): ProcessStoreForMethod<P, S>;
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
  Methods extends Record<string, ProcessStoreForMethod<any, any>>,
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
  | { readonly _tag: typeof FOR_TAG; readonly methods: Record<string, ProcessStoreForMethod<any, any>> }
  | { readonly _tag: typeof FOR_TAG; readonly fn: (id: string, s: ProcessStoreSpine) => Record<string, unknown> };

type ProcessStoreFacetAnySection =
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

type ProcessStoreQuerySectionOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  Extract<Sections[number], { readonly _tag: typeof QUERY_TAG }>;

type ProcessStoreForSectionOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  Extract<Sections[number], { readonly _tag: typeof FOR_TAG }>;

type ProcessStoreTelemetrySectionOf<
  Sections extends ReadonlyArray<ProcessStoreFacetAnySection>,
> = Extract<Sections[number], { readonly _tag: typeof TELEMETRY_TAG }>;

type ProcessStoreEmitApiOf<Sections extends ReadonlyArray<ProcessStoreFacetAnySection>> =
  ProcessStoreTelemetrySectionOf<Sections> extends ProcessStoreTelemetrySection<
    infer EmitApi extends object
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
        infer Methods extends Record<string, ProcessStoreForMethod<any, any>>
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
        infer Methods extends Record<string, ProcessStoreForMethod<any, any>>
      >
      ? SchemasFromMethods<Methods>
      : Record<never, never>;

type IdentifierFactory<IdentifierApi> = {
  readonly [IDENTIFIER_FACTORY]: (identifier: string) => IdentifierApi;
};

// ============================================================================
// Section constructors
// ============================================================================


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
  const Methods extends Record<string, ProcessStoreForMethod<any, any>>,
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

// ============================================================================
// Emit statics builders
// ============================================================================

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

// ============================================================================
// Facet class type
// ============================================================================

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
  readonly layerQuery:          Layer.Layer<Context.Service<any, QueryApi>, never, RuntimeStorage>;
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
  layerQuery: Layer.Layer<Context.Service<any, QueryApi>, never, RuntimeStorage>,
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
): Record<never, never> | { forQuery: (id: ProcessStoreFullIdentifierInput) => Effect.Effect<IdentifierApi, never, Context.Service<any, QueryApi>> } => {
  if (anyForSection === undefined) return {};
  const forQuery = (input: ProcessStoreFullIdentifierInput): Effect.Effect<IdentifierApi, never, Context.Service<any, QueryApi>> => {
    const id = resolveIdentifier(input);
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

    let telemetrySection: ProcessStoreTelemetrySection<TelemetryNestedEmitApi> | undefined;
    let anyQuerySection: AnyQuerySection | undefined;
    let anyForSection: AnyForSection | undefined;

    for (const section of sections) {
      switch (section._tag) {
        case TELEMETRY_TAG: telemetrySection = section; break;
        case QUERY_TAG:     anyQuerySection  = section as AnyQuerySection; break;
        case FOR_TAG:       anyForSection    = section as AnyForSection; break;
      }
    }

    if (anyQuerySection === undefined) {
      throw new Error(`ProcessStore facet ${id}: query section is required`);
    }
    if (telemetrySection === undefined) {
      throw new Error(`ProcessStore facet ${id}: telemetry section is required`);
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
        const emitApi = telemetrySection!.fn(s) as EmitApi;

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

    const emitStatics = buildNestedEmitStatics(
      telemetrySection.emitPaths,
      Base,
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

    // layerQuery — builds a read-only query view directly from RuntimeStorage;
    // attaches IDENTIFIER_FACTORY when forMethods are present so forQuery(id) works.
    const layerQuery: Layer.Layer<Context.Service<any, QueryApi>, never, RuntimeStorage> = Layer.effect(
      queryTag as any,
      Effect.gen(function* () {
        const s = yield* buildStore;
        const queryApi = (queryMethods !== undefined
          ? bindQueryMethods(queryMethods, s)
          : "fn" in anyQuerySection! ? (anyQuerySection as any).fn(s) : {}
        ) as object;
        if (forMethods !== undefined) {
          attachIdentifierFactory(queryApi, (identifier: string) =>
            bindForMethods(forMethods, identifier, s) as unknown as IdentifierApi & Record<string, unknown>,
          );
        }
        return queryApi as unknown as QueryApi;
      }),
    ) as any;

    // layerRemote — routes queries over RPC, no local dependencies.
    // Only supported for schema-annotated (methods-based) facets.
    const makeLayerRemote = (client: ProcessStoreQueryClient): Layer.Layer<Context.Service<any, QueryApi>, never, never> => {
      if (queryMethods === undefined) {
        return Layer.effect(
          queryTag as any,
          Effect.die(
            `ProcessStore facet "${processTag}": layerRemote requires schema-annotated query methods. ` +
            `Migrate to ProcessStore.payload().success().resolve().`,
          ),
        ) as any;
      }
      const remoteQueryApi = Record.map(queryMethods, (_, methodName) =>
        (payload: unknown) => client.query(processTag, methodName, payload),
      ) as unknown as object;
      if (forMethods !== undefined) {
        attachIdentifierFactory(remoteQueryApi, (identifier: string) =>
          Record.map(forMethods, (_, methodName) =>
            (payload: unknown) => client.queryFor(processTag, identifier, methodName, payload),
          ) as unknown as IdentifierApi & Record<string, unknown>,
        );
      }
      return Layer.succeed(queryTag as any, remoteQueryApi as unknown as QueryApi) as any;
    };

    const forQueryMember = buildForQueryMember<QueryApi, IdentifierApi & Record<string, unknown>>(
      anyForSection,
      queryTag,
    );

    const schemas = (
      queryMethods !== undefined ? extractSchemas(queryMethods) : {}
    ) as QuerySchemas;

    const forSchemas = (
      forMethods !== undefined ? extractSchemas(forMethods) : {}
    ) as ForSchemas;

    const assembled = assembleFacetClass<Self, Id, Tag, EmitApi, QueryApi & Record<string, unknown>, IdentifierApi & Record<string, unknown>, QuerySchemas, ForSchemas>(
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
    if (queryMethods !== undefined) Object.assign(assembled, { _methods: queryMethods });
    if (forMethods !== undefined) Object.assign(assembled, { _forMethods: forMethods });
    return assembled;
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
  readonly _methods?: Record<string, ProcessStoreMethod<any, any>>;
  readonly _forMethods?: Record<string, ProcessStoreForMethod<any, any>>;
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
    if (facet._methods !== undefined) {
      lookup[facet._processTag] = Record.map(facet._methods, (m) => ({
        payload: m.payload,
        success: m.success,
        resolve: m.resolve,
      }));
    }
    if (facet._forMethods !== undefined) {
      forLookup[facet._processTag] = Record.map(facet._forMethods, (m) => ({
        payload: m.payload,
        success: m.success,
        resolve: m.resolve,
      }));
    }
  }

  return {
    typeMap:    {} as RegistryTypeMap<Facets>,
    forTypeMap: {} as RegistryForTypeMap<Facets>,
    lookup,
    forLookup,
  };
};
